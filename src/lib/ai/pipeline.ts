/**
 * TM-102 — Multi-step generation pipeline.
 *
 *   1. generateOutline(prompt)            → narrative + palette + scenes[]
 *   2. generateSceneSpec(outline, idx)    → per-scene visual + motion spec
 *   3. generateSceneCode(outline, spec, idx) → TSX body for that scene
 *   4. compose(outline, sceneCodes[])     → single GeneratedAsset module
 *
 * See `[[ADR-0020]]` for the design rationale.
 *
 * The pipeline is gated behind `AI_MULTI_STEP=1` (off by default). The
 * single-shot `generateAsset` continues to be the production path until
 * TM-46 r7 demonstrates a bench-mean uplift on the visual judge.
 */

import { chatComplete, getModels } from './client';
import {
  OUTLINE_SYSTEM_PROMPT,
  SCENE_SPEC_SYSTEM_PROMPT,
  SCENE_CODE_SYSTEM_PROMPT,
} from './prompts';
import { extractParameters } from './extract-params';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import { runAssetGenStage, detectLivingEntity, type AssetGenStageResult } from './asset-gen-stage';
import { recordMark, isLatencyProfileEnabled, newRequestId } from './latency-profile';
import type {
  GeneratedAsset,
  GenerateApiResponse,
  ClarifyAnswers,
  PipelineTiming,
  PipelineTimingStage,
} from '@/types';

/* ------------------------------------------------------------------ */
/* TM-111 — Forbidden-token sanitizer (gpt-4o failure modes)           */
/* ------------------------------------------------------------------ */

/**
 * TM-111: gpt-4o has a strong tendency to emit Node-isms (`require(...)`,
 * `globalThis.X`, dynamic `import(...)`, `new Function(...)`) inside
 * scene-code fragments even when the system prompt forbids them. The
 * sandbox validator (defense-in-depth) then rejects the entire scene,
 * causing 4/5 cases in the TM-108 benchmark to 500.
 *
 * This pre-validation pass scrubs the most common, structurally-safe
 * token patterns before `validateCode` runs. The transformation is
 * conservative — when in doubt we drop the offending statement rather
 * than rewrite it (the LLM virtually never *needs* these tokens for a
 * Remotion component, so removing them produces working code in
 * practice).
 *
 * Returns the sanitized source plus a list of `notes` describing what
 * was changed (for telemetry / retro). When `notes` is non-empty the
 * caller should still re-run `validateCode` to catch anything missed.
 */
export interface ForbiddenSanitizeResult {
  code: string;
  notes: string[];
}

export function sanitizeForbiddenTokens(input: string): ForbiddenSanitizeResult {
  const notes: string[] = [];
  let code = input;

  // 1. `const X = require('...')` / `const { a, b } = require('...')` —
  //    drop the whole declaration. Remotion runtime injects all
  //    React/Remotion globals so a CJS require is never legitimate.
  //
  //    TM-114 — the original single-line regex missed multi-line destructures
  //    (e.g. gpt-4o emits
  //
  //        const {
  //          interpolate,
  //          spring,
  //          Easing
  //        } = require('remotion');
  //
  //    ) which then fell through to the `bareRequire` fallback below. That
  //    fallback rewrote the RHS `require(...)` to `undefined`, leaving
  //    `const { interpolate, spring, Easing } = undefined;` — which throws
  //    `Cannot destructure property 'interpolate' of 'undefined'` at React
  //    *render* time, hitting the studio's ErrorBoundary on every multi-step
  //    asset (TM-108 r3: 100% `<Unknown>` ErrorBoundary noise).
  //
  //    The new pattern allows the LHS (identifier or destructure pattern) to
  //    span newlines, so we drop the whole statement before the bare-require
  //    fallback fires.
  const requireDeclMulti = /^[ \t]*(?:const|let|var)\s+(?:\{[\s\S]*?\}|\[[\s\S]*?\]|[A-Za-z_$][\w$]*)\s*=\s*require\s*\([^)]*\)\s*;?[ \t]*$/gm;
  if (requireDeclMulti.test(code)) {
    code = code.replace(requireDeclMulti, '');
    notes.push('stripped `const … = require(...)` declarations');
  }
  // Bare `require(...)` calls anywhere → replace with `undefined`. After the
  // multi-line declaration sweep above, anything still here is either an
  // expression-position require (`x = require('x').foo`, `require('x')(...)`,
  // etc.) where the substitution is benign, or a stray that the LLM emitted
  // outside any declaration we recognise.
  const bareRequire = /\brequire\s*\([^)]*\)/g;
  if (bareRequire.test(code)) {
    code = code.replace(bareRequire, 'undefined /* TM-111: require stripped */');
    notes.push('replaced bare require(...) with undefined');
  }

  // 1b. TM-114 — gpt-4o sometimes emits the *result* of an earlier
  //     hallucinated rewrite directly (e.g. `const { spring } = undefined;`)
  //     or simulates a missing module by destructuring `null`. Either form
  //     throws `Cannot destructure property 'X' of 'undefined'` at React
  //     render time and there is no legitimate use of the pattern in a
  //     Remotion scene. Strip the whole statement so the destructured idents
  //     fall through to the runtime-injected globals (interpolate / spring /
  //     Easing / …) declared at the factory body's top.
  const brokenDestructure = /^[ \t]*(?:const|let|var)\s+(?:\{[\s\S]*?\}|\[[\s\S]*?\])\s*=\s*(?:undefined|null)\s*;?[ \t]*$/gm;
  if (brokenDestructure.test(code)) {
    code = code.replace(brokenDestructure, '');
    notes.push('stripped `const { … } = undefined|null` broken destructures');
  }

  // 2. `globalThis.X` / `globalThis['X']` — rewrite to plain `X` so the
  //    code still references the runtime-injected global. TM-108 saw
  //    `globalThis.useCurrentFrame()` etc.
  if (/\bglobalThis\b/.test(code)) {
    code = code
      .replace(/\bglobalThis\s*\?\.\s*/g, '')
      .replace(/\bglobalThis\s*\.\s*/g, '')
      .replace(/\bglobalThis\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/g, '$1')
      // Standalone `globalThis` identifier (rare) → `undefined`
      .replace(/\bglobalThis\b/g, 'undefined');
    notes.push('rewrote globalThis.X / globalThis["X"] to bare identifiers');
  }

  // 3. Dynamic `import(...)` expressions → drop. The runtime cannot
  //    serve them anyway. We coerce to `undefined` so `await import(...)`
  //    becomes `await undefined` which is harmless at module-eval.
  if (/\bimport\s*\(/.test(code)) {
    code = code.replace(/\bimport\s*\(\s*[^)]*\)/g, 'undefined /* TM-111: dynamic import stripped */');
    notes.push('replaced dynamic import(...) with undefined');
  }

  // 4. `new Function(...)` / `Function('...')` — drop entire RHS.
  if (/\b(?:new\s+)?Function\s*\(/.test(code)) {
    code = code.replace(/\bnew\s+Function\s*\([^)]*\)/g, '(() => null)');
    code = code.replace(/(?<!\w)Function\s*\(\s*['"`][^'"`]*['"`]\s*(?:,\s*['"`][^'"`]*['"`]\s*)*\)/g, '(() => null)');
    notes.push('replaced Function(...) constructor with (() => null)');
  }

  // 5. `process.X` references inside scene code → drop. Remotion code
  //    has no business reading process state.
  if (/\bprocess\s*\./.test(code)) {
    code = code.replace(/\bprocess\s*\.\s*[A-Za-z_$][\w$]*/g, 'undefined');
    notes.push('replaced process.X with undefined');
  }

  // 6. Module loaders smuggled via `import.meta` → strip.
  if (/import\.meta\b/.test(code)) {
    code = code.replace(/\bimport\.meta\b/g, 'undefined');
    notes.push('replaced import.meta with undefined');
  }

  // 7. TM-117 — `"use client"` / `"use server"` / `"use strict"` directives at
  //    the head of a scene fragment make the composed module's line 1 start
  //    with a string literal directive. After sanitizeCode strips imports,
  //    such a directive lands on line 1 of the input to sucrase and, when
  //    followed by certain trailing tokens, has been observed to manifest as
  //    `Unexpected token, expected "(" (1:46)` (TM-108 r3/r5 case 1). The
  //    composer doesn't need any of these — the wrapper is the only
  //    legitimate place a directive belongs and the evaluator already runs
  //    under `"use strict"`. Strip them defensively.
  const directiveLine = /^[ \t]*['"]use (?:client|server|strict)['"];?[ \t]*\r?\n?/gm;
  if (directiveLine.test(code)) {
    code = code.replace(directiveLine, '');
    notes.push('stripped "use client"/"use server"/"use strict" directives');
  }

  // 8. TM-117 — zero-width / BOM / non-breaking-space characters at the head
  //    of a scene fragment trip sucrase's tokenizer (e.g. `﻿`, `​`,
  //    ` `). gpt-4o occasionally emits these as decorative invisible
  //    characters after copy-pasting from a doc-style prompt. Normalize to
  //    standard spaces / strip entirely.
  if (/[﻿​-‍⁠]/.test(code)) {
    code = code.replace(/[﻿​-‍⁠]/g, '');
    notes.push('stripped zero-width / BOM characters');
  }
  if (/ /.test(code)) {
    code = code.replace(/ /g, ' ');
    notes.push('replaced non-breaking spaces with regular spaces');
  }

  // 9. TM-118 — `<lucide.Icon name="..."/>` / `<Icon name="..."/>` hallucination.
  //
  //    gpt-4o reliably hallucinates a generic lucide `<Icon name="some-slug" />`
  //    API (cf. react-native-vector-icons / older MUI) that does NOT exist in
  //    lucide-react. The real `Icon` export expects an `iconNode` array prop;
  //    when called with only a string `name` it crashes inside the forwardRef
  //    renderer at `iconNode.map(...)` — `TypeError: Cannot read properties of
  //    undefined (reading 'map')`. React's dev-mode componentStack shows this
  //    as `<Unknown>` because lucide forwardRef components have no displayName.
  //
  //    This is the root cause of the TM-108 r3 → r6 case 2 (long-video) +
  //    case 3 (url-ingest) `<Unknown>` EB residue that survived TM-116/TM-117.
  //    The 60s long-video prompt invites a "logo + tagline" intro, and URL
  //    ingest prompts ship a `source: https://news.ycombinator.com` context
  //    that nudges the model toward `<lucide.Icon name="hacker-news" />` —
  //    both deterministically produce the failure mode.
  //
  //    Fix: rewrite to a known-safe icon. We map the slug to a PascalCase
  //    lucide identifier (e.g. `hacker-news` → `Hash`, `company-logo` →
  //    `Sparkles`) where we recognise it, else fall back to `lucide.Star`.
  const luxIconRe = /<\s*(?:lucide\.)?Icon\b([^/>]*)\bname\s*=\s*(?:["']([^"']*)["']|\{\s*["']([^"']*)["']\s*\})([^/>]*)\/?>/g;
  if (luxIconRe.test(code)) {
    luxIconRe.lastIndex = 0;
    code = code.replace(luxIconRe, (_full, before, n1, n2, after) => {
      const slug = String(n1 || n2 || '').trim().toLowerCase();
      const map: Record<string, string> = {
        'hacker-news': 'Hash',
        'hackernews': 'Hash',
        'news': 'Newspaper',
        'logo': 'Sparkles',
        'company-logo': 'Sparkles',
        'brand': 'Sparkles',
        'cta': 'ArrowRight',
        'arrow': 'ArrowRight',
        'check': 'Check',
        'heart': 'Heart',
        'star': 'Star',
        'rocket': 'Rocket',
        'flame': 'Flame',
        'trophy': 'Trophy',
        'chart': 'ChartBar',
        'graph': 'ChartBar',
      };
      const mapped = map[slug] || 'Star';
      const stripName = (s: string) =>
        s.replace(/\bname\s*=\s*(?:["'][^"']*["']|\{[^}]*\})/g, '').replace(/\s{2,}/g, ' ');
      const cleanBefore = stripName(String(before || ''));
      const cleanAfter = stripName(String(after || ''));
      return `<lucide.${mapped}${cleanBefore}${cleanAfter}/>`;
    });
    notes.push('rewrote <lucide.Icon name="..."/> hallucination to a real lucide icon');
  }

  return { code, notes };
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface OutlineScene {
  name: string;
  role:
    | 'title-reveal'
    | 'data-viz'
    | 'transition'
    | 'text-anim'
    | 'loader'
    | 'infographic'
    | 'outro';
  durationInFrames: number;
  keyElements: string[];
  narrativeBeat: string;
}

export interface OutlinePalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  rationale?: string;
}

export interface Outline {
  title: string;
  totalDurationInFrames: number;
  fps: number;
  width: number;
  height: number;
  palette: OutlinePalette;
  scenes: OutlineScene[];
}

export interface SceneSpec {
  name: string;
  description: string;
  animationType: 'spring' | 'interpolate' | 'sequence' | 'combination';
  palette: OutlinePalette;
  text?: Array<{
    content: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    color?: string;
  }>;
  elements?: Array<{
    kind: string;
    label: string;
    from?: Record<string, number>;
    to?: Record<string, number>;
  }>;
  motion?: {
    keyframes?: Array<{ frame: number; what: string }>;
    easing?: string;
    springs?: Array<{ target: string; damping: number; mass: number; stiffness: number }>;
  };
  params?: Array<{
    name: string;
    kind: 'color' | 'range' | 'text' | 'boolean' | 'select' | 'icon';
    default?: unknown;
    min?: number;
    max?: number;
    options?: string[];
  }>;
}

/* ------------------------------------------------------------------ */
/* TM-104 — Long-form duration handling                                */
/* ------------------------------------------------------------------ */

/**
 * Default fps when the prompt gives no cue.
 */
export const DEFAULT_FPS = 30;

/**
 * Hard cap on scene count. TM-102 originally capped at 4 (≤ 5s output).
 * TM-104 raises this to 12 so a 120s prompt can be split into ~10s scenes
 * without overflowing the parallel scene-spec / scene-code fan-out.
 */
export const MAX_SCENES = 12;

/**
 * Target seconds per scene when auto-splitting a long-form prompt. Picked
 * so that:
 *   - 5s prompt  → 1 scene
 *   - 10s prompt → 1 scene
 *   - 15s prompt → 2 scenes (~7.5s each)
 *   - 30s prompt → 3 scenes (~10s each)
 *   - 60s prompt → 4 scenes (~15s each)
 *   - 120s prompt → 8 scenes (~15s each)
 */
const TARGET_SECONDS_PER_SCENE = 15;
const MIN_SECONDS_PER_SCENE = 5;

export interface DurationHint {
  /** Total seconds extracted from the prompt. null if no hint. */
  seconds: number | null;
  /** The matched substring (for telemetry / debug). */
  matched?: string;
}

/**
 * Heuristic extractor for duration cues in the user prompt. Recognizes:
 *   - Korean: "60초", "2분", "1분 30초"
 *   - English: "60 seconds", "60s", "2 minutes", "2 min", "1m30s"
 *   - Bare numerals followed by a unit token.
 * Returns null when no hint is present (caller falls back to LLM default).
 */
export function extractDurationHint(prompt: string): DurationHint {
  const text = prompt.toLowerCase();

  // 1m30s / 1m 30s
  const mmss = text.match(/(\d+)\s*m(?:in(?:ute)?s?)?\s*(\d+)\s*s(?:ec(?:ond)?s?)?/);
  if (mmss) {
    const sec = Number(mmss[1]) * 60 + Number(mmss[2]);
    return { seconds: sec, matched: mmss[0] };
  }

  // Korean compound: 1분 30초 / 2분 0초
  const krCompound = prompt.match(/(\d+)\s*분\s*(\d+)\s*초/);
  if (krCompound) {
    return {
      seconds: Number(krCompound[1]) * 60 + Number(krCompound[2]),
      matched: krCompound[0],
    };
  }

  // Korean minutes only: 2분
  const krMin = prompt.match(/(\d+)\s*분(?!\s*\d)/);
  if (krMin) return { seconds: Number(krMin[1]) * 60, matched: krMin[0] };

  // Korean seconds: 60초
  const krSec = prompt.match(/(\d+)\s*초/);
  if (krSec) return { seconds: Number(krSec[1]), matched: krSec[0] };

  // English minutes: "2 minutes", "2 min", "2m"
  const enMin = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b(?!\s*\d)/);
  if (enMin) return { seconds: Number(enMin[1]) * 60, matched: enMin[0] };

  // English seconds: "60 seconds", "60 sec", "60s"
  const enSec = text.match(/(\d+)\s*(?:seconds?|secs?|s)\b/);
  if (enSec) return { seconds: Number(enSec[1]), matched: enSec[0] };

  return { seconds: null };
}

/**
 * Decide how many scenes to use given a target duration in seconds. The
 * result is clamped to [1, MAX_SCENES].
 */
export function planSceneCount(seconds: number): number {
  if (seconds <= 10) return 1;
  const raw = Math.round(seconds / TARGET_SECONDS_PER_SCENE);
  return Math.max(1, Math.min(MAX_SCENES, raw));
}

/**
 * Build an evenly-distributed scene duration plan (in frames) that always
 * sums exactly to `seconds * fps`. Last scene absorbs any rounding drift.
 */
export function planSceneDurations(
  seconds: number,
  fps: number = DEFAULT_FPS,
  sceneCount?: number,
): { fps: number; totalFrames: number; sceneFrames: number[] } {
  const safeSeconds = Math.max(MIN_SECONDS_PER_SCENE, Math.round(seconds));
  const safeFps = fps > 0 ? Math.round(fps) : DEFAULT_FPS;
  const n = sceneCount ?? planSceneCount(safeSeconds);
  const totalFrames = safeSeconds * safeFps;
  const baseFrames = Math.floor(totalFrames / n);
  const sceneFrames: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      sceneFrames.push(totalFrames - acc);
    } else {
      sceneFrames.push(baseFrames);
      acc += baseFrames;
    }
  }
  return { fps: safeFps, totalFrames, sceneFrames };
}

/* ------------------------------------------------------------------ */
/* Cost guard (ADR-0020 §"Cost / latency tradeoff")          */
/* ------------------------------------------------------------------ */

/**
 * Token-cost ratio threshold above which the pipeline emits a soft
 * warning so the caller (orchestrator) can ask the user for explicit
 * opt-in. Pinned in code AND in the ADR so changing it requires both.
 */
export const MULTI_STEP_COST_RATIO_WARN = 1.7;

/**
 * Coarse projected token-multiplier vs single-shot, given an outline's
 * scene count. The orchestrator multiplies its baseline single-shot
 * estimate by this factor to decide whether to surface the warning.
 *
 * Empirical (TM-102 live smoke):
 *   1 scene  ≈ 1.4×  | 2 scenes ≈ 1.7×  | 3 scenes ≈ 2.0×  | 4 ≈ 2.4×
 *   TM-104 extrapolation: 8 scenes ≈ 4.0×, 12 scenes ≈ 5.6×.
 */
export function projectedMultiStepCostRatio(sceneCount: number): number {
  if (sceneCount <= 0) return 1;
  return 1 + 0.35 * sceneCount + 0.05 * Math.max(0, sceneCount - 1);
}

/* ------------------------------------------------------------------ */
/* JSON helpers (kept local — generate.ts has its own copy)            */
/* ------------------------------------------------------------------ */

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenceStripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const start = fenceStripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;
  for (let i = start; i < fenceStripped.length; i++) {
    const ch = fenceStripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx < 0) return null;
  try {
    return JSON.parse(fenceStripped.slice(start, endIdx + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Stage 1 — Outline                                                  */
/* ------------------------------------------------------------------ */

export async function generateOutline(
  prompt: string,
  model: string,
  opts: { minScenes?: number } = {},
): Promise<Outline> {
  // TM-104 — extract duration hint up-front so we can:
  //   (a) inject a hard directive into the outline prompt,
  //   (b) post-fix the LLM result if it ignores the directive.
  // TM-139 — `opts.minScenes` (typically 2) lets the caller force a scene
  // floor for character/scene prompts where a single-scene outline collapses
  // the multi-step reasoning into single-shot equivalent (TM-124 RCA).
  const hint = extractDurationHint(prompt);
  const minScenes = Math.max(1, opts.minScenes ?? 1);
  let userMessage = prompt;
  let plan: ReturnType<typeof planSceneDurations> | null = null;
  // Compute a duration plan whenever we either (a) have an explicit
  // user-supplied length hint > 10s, OR (b) need to enforce a scene floor
  // from `opts.minScenes` (TM-139). For (b) without a hint we fall back to
  // a sensible default so the directive arithmetic still works.
  const effectiveSeconds = hint.seconds && hint.seconds > 0 ? hint.seconds : null;
  const needsPlan = (effectiveSeconds !== null && effectiveSeconds > 10) || minScenes > 1;
  if (needsPlan) {
    const baseSeconds = effectiveSeconds ?? Math.max(10, minScenes * MIN_SECONDS_PER_SCENE);
    const autoCount = planSceneCount(baseSeconds);
    const sceneCount = Math.max(autoCount, minScenes);
    plan = planSceneDurations(baseSeconds, DEFAULT_FPS, sceneCount);
    const directive =
      `\n\n---\nDURATION DIRECTIVE (TM-104${minScenes > 1 ? '/TM-139' : ''}): ` +
      (effectiveSeconds
        ? `The user asked for a ~${effectiveSeconds}s video. `
        : `Target a ${baseSeconds}s composition. `) +
      `Target totalDurationInFrames=${plan.totalFrames} at fps=${plan.fps}. ` +
      `Use ${plan.sceneFrames.length} scenes (minimum ${minScenes}) with durations ` +
      `[${plan.sceneFrames.join(', ')}] frames respectively. ` +
      (minScenes > 1
        ? `A single-scene outline is REJECTED for this prompt — split the narrative into ` +
          `at least ${minScenes} distinct beats (e.g. setup → action, intro → climax).`
        : '');
    userMessage = prompt + directive;
  }
  const text = await chatComplete({
    model,
    system: OUTLINE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  const parsed = extractJsonObject(text);
  if (!parsed) throw new Error('TM-102 outline: AI did not return valid JSON');
  let outline = validateOutline(parsed);
  // Post-fix: if the LLM ignored the duration directive, force the plan.
  if (plan && Math.abs(outline.totalDurationInFrames - plan.totalFrames) > plan.fps) {
    outline = enforceScenePlan(outline, plan);
  }
  // TM-139 — even if duration matched, enforce the scene floor. The LLM
  // commonly returns N=1 for short prompts despite the directive.
  if (plan && outline.scenes.length < minScenes) {
    outline = enforceScenePlan(outline, plan);
  }
  return outline;
}

/**
 * Force-apply a scene plan to an outline. Preserves narrative content
 * (names, roles, beats) but rewrites durations so the final composition
 * matches the user's requested length exactly. Pads or trims scenes.
 */
export function enforceScenePlan(
  outline: Outline,
  plan: { fps: number; totalFrames: number; sceneFrames: number[] },
): Outline {
  const targetCount = plan.sceneFrames.length;
  const scenes: OutlineScene[] = [];
  for (let i = 0; i < targetCount; i++) {
    const src = outline.scenes[i % outline.scenes.length];
    scenes.push({
      name: outline.scenes[i]?.name ?? `${src.name}-${i + 1}`,
      role: outline.scenes[i]?.role ?? src.role,
      durationInFrames: plan.sceneFrames[i],
      keyElements: outline.scenes[i]?.keyElements ?? src.keyElements,
      narrativeBeat: outline.scenes[i]?.narrativeBeat ?? src.narrativeBeat,
    });
  }
  return {
    ...outline,
    fps: plan.fps,
    totalDurationInFrames: plan.totalFrames,
    scenes,
  };
}

export function validateOutline(raw: Record<string, unknown>): Outline {
  const title = (raw.title as string) || 'Untitled';
  const totalDurationInFrames = Number(raw.totalDurationInFrames) || 150;
  const fps = Number(raw.fps) || 30;
  const width = Number(raw.width) || 1920;
  const height = Number(raw.height) || 1080;
  const palette = raw.palette as OutlinePalette | undefined;
  if (!palette || !palette.primary || !palette.background) {
    throw new Error('TM-102 outline: missing palette.primary or palette.background');
  }
  const scenesRaw = raw.scenes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length === 0) {
    throw new Error('TM-102 outline: scenes[] must be a non-empty array');
  }
  if (scenesRaw.length > MAX_SCENES) {
    throw new Error(
      'TM-104 outline: scenes[] capped at ' + MAX_SCENES + ' (got ' + scenesRaw.length + ')',
    );
  }
  const scenes: OutlineScene[] = scenesRaw.map((s, i) => {
    const o = s as Record<string, unknown>;
    return {
      name: (o.name as string) || `scene${i + 1}`,
      role: ((o.role as OutlineScene['role']) || 'text-anim'),
      durationInFrames: Number(o.durationInFrames) || Math.round(totalDurationInFrames / scenesRaw.length),
      keyElements: Array.isArray(o.keyElements) ? (o.keyElements as string[]) : [],
      narrativeBeat: (o.narrativeBeat as string) || '',
    };
  });
  // Normalize duration sum to outline.totalDurationInFrames so the
  // composition timeline lines up regardless of LLM arithmetic mistakes.
  const sum = scenes.reduce((a, b) => a + b.durationInFrames, 0);
  if (sum !== totalDurationInFrames && sum > 0) {
    const scale = totalDurationInFrames / sum;
    let acc = 0;
    for (let i = 0; i < scenes.length; i++) {
      const isLast = i === scenes.length - 1;
      const next = isLast
        ? totalDurationInFrames - acc
        : Math.max(1, Math.round(scenes[i].durationInFrames * scale));
      scenes[i].durationInFrames = next;
      acc += next;
    }
  }
  return {
    title,
    totalDurationInFrames,
    fps,
    width,
    height,
    palette,
    scenes,
  };
}

/* ------------------------------------------------------------------ */
/* Stage 2 — Scene spec                                               */
/* ------------------------------------------------------------------ */

export async function generateSceneSpec(
  outline: Outline,
  sceneIdx: number,
  model: string,
): Promise<SceneSpec> {
  if (sceneIdx < 0 || sceneIdx >= outline.scenes.length) {
    throw new Error(`TM-102 scene-spec: index ${sceneIdx} out of range`);
  }
  const userPayload = JSON.stringify(
    { outline, sceneIndex: sceneIdx, scene: outline.scenes[sceneIdx] },
    null,
    2,
  );
  const text = await chatComplete({
    model,
    system: SCENE_SPEC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPayload }],
  });
  const parsed = extractJsonObject(text);
  if (!parsed) {
    throw new Error(`TM-102 scene-spec[${sceneIdx}]: AI did not return valid JSON`);
  }
  // Back-fill palette from outline if scene spec omits it (LLMs sometimes do).
  if (!parsed.palette) parsed.palette = outline.palette;
  if (!parsed.name) parsed.name = outline.scenes[sceneIdx].name;
  return parsed as unknown as SceneSpec;
}

/* ------------------------------------------------------------------ */
/* Stage 3 — Scene code (TSX fragment per scene)                       */
/* ------------------------------------------------------------------ */

export async function generateSceneCode(
  outline: Outline,
  spec: SceneSpec,
  sceneIdx: number,
  model: string,
  /** TM-90 — when present, scene code may splice `<Img src={imageUrl} />`. */
  imageUrl?: string | null,
): Promise<string> {
  const userPayload = JSON.stringify(
    {
      outline: {
        title: outline.title,
        palette: outline.palette,
        fps: outline.fps,
      },
      sceneIndex: sceneIdx,
      sceneNumber: sceneIdx + 1,
      spec,
      ...(imageUrl ? { imageUrl } : {}),
    },
    null,
    2,
  );
  // TM-90 — when an image URL is available, append a hint that the scene
  // code SHOULD splice it via `<Img src={imageUrl} />` rather than drawing
  // the living entity from primitives. The LLM is reliably bad at vector
  // animals; offloading the figure to a generated PNG fixes the largest
  // single class of TM-46 visual-judge failures.
  const systemPrompt = imageUrl
    ? SCENE_CODE_SYSTEM_PROMPT +
      `\n\nIMAGE ASSET (TM-90): A pre-generated PNG of the prompt's character/animal/person is available at \`imageUrl\` in this payload. ` +
      `If the scene's narrativeBeat features that subject, render it via \`<Img src={imageUrl} style={{ width, height, objectFit: 'contain' }} />\` ` +
      `(absolute-positioned inside the AbsoluteFill) and animate position/scale/opacity around it instead of drawing a vector approximation. ` +
      `The Img component is a Remotion global — no import needed.`
    : SCENE_CODE_SYSTEM_PROMPT;
  const text = await chatComplete({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPayload }],
  });
  const parsed = extractJsonObject(text);
  if (!parsed) {
    throw new Error(`TM-102 scene-code[${sceneIdx}]: AI did not return valid JSON`);
  }
  let rawCode = parsed.code as string | undefined;
  if (!rawCode || rawCode.trim().length < 100) {
    throw new Error(`TM-102 scene-code[${sceneIdx}]: too short or missing`);
  }
  // TM-117 — gpt-4o occasionally double-escapes its `code` payload, returning
  // `"code": "const x = {\\n  ..."` so JSON.parse yields a string containing
  // LITERAL backslash-n two-character sequences rather than real newlines.
  // sucrase then sees a single physical line whose `\n` token is an invalid
  // escape inside an identifier context, surfacing as
  // `Unexpected token, expected "(" (1:46)` (TM-108 r5 case 1). Unescape the
  // common JSON-string escapes here so the downstream sanitize / transpile
  // sees the same code the LLM "meant" to emit.
  //
  // We only run the rewrite when the fragment clearly contains literal
  // escapes AND no real newlines (single-line payload). The heuristic avoids
  // touching well-formed multi-line code where `\\n` might legitimately
  // appear inside a string literal.
  if (!/\n/.test(rawCode) && /\\n/.test(rawCode)) {
    rawCode = rawCode
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[TM-117] scene-code[${sceneIdx}] un-escaped literal \\n sequences`);
    }
  }
  // TM-111 — pre-scrub gpt-4o failure tokens (require / globalThis /
  // dynamic import / Function ctor / process / import.meta) BEFORE the
  // sandbox validator runs. This converts ~80% of multi-step 500s into
  // valid scenes without dropping the LLM output entirely.
  const { code: scrubbed, notes } = sanitizeForbiddenTokens(rawCode);
  if (notes.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn(`[TM-111] scene-code[${sceneIdx}] auto-sanitized:`, notes);
  }
  const validation = validateCode(scrubbed);
  if (!validation.valid) {
    throw new SceneSandboxError(
      `TM-102 scene-code[${sceneIdx}] failed sandbox validation after TM-111 sanitize: ${validation.errors.join(', ')}`,
      sceneIdx,
      validation.errors,
    );
  }
  return sanitizeCode(scrubbed);
}

/**
 * TM-111 — distinct error class so the orchestrator can catch sandbox
 * rejections specifically and decide whether to fall back to single-shot.
 */
export class SceneSandboxError extends Error {
  readonly sceneIdx: number;
  readonly sandboxErrors: string[];
  constructor(message: string, sceneIdx: number, sandboxErrors: string[]) {
    super(message);
    this.name = 'SceneSandboxError';
    this.sceneIdx = sceneIdx;
    this.sandboxErrors = sandboxErrors;
  }
}

/* ------------------------------------------------------------------ */
/* Stage 4 — Composition                                              */
/* ------------------------------------------------------------------ */

/**
 * TM-112 — Introspect a single scene fragment to discover the identifiers
 * the LLM actually used. The scene-code system prompt asks for
 * `Scene{N}Params` + `Scene{N}`, but gpt-4o reliably drifts (e.g. emits
 * `Scene1Params` for every scene, omits the params const entirely, or
 * names the component `SceneOne`). The composer must not assume the
 * canonical names exist — instead it discovers what the fragment defines
 * and references those identifiers verbatim.
 *
 * Strategy:
 *   - Component: prefer `Scene{N}` if present, else first top-level
 *     PascalCase const/function whose name starts with `Scene`, else
 *     first PascalCase identifier defined in the fragment, else `null`.
 *   - Params: prefer `Scene{N}Params`, else first top-level
 *     `const \\w*Params\\b`, else `null` (caller falls back to `{}`).
 *
 * "Top-level" here means the regex matches a declaration at column 0 (or
 * after only whitespace). This is a heuristic but it avoids picking up
 * `Scene1Params` references that appear *inside* a function body —
 * exactly the failure mode that caused TM-108 r2's 5/5 ReferenceError.
 */
function findSceneIdentifiers(
  fragment: string,
  sceneNumber: number,
): { component: string | null; params: string | null } {
  const expectedComponent = `Scene${sceneNumber}`;
  const expectedParams = `Scene${sceneNumber}Params`;

  const topLevelDecls = [
    ...fragment.matchAll(/(?:^|\n)\s*(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)\s*[=(:]/g),
  ].map(m => m[1]);
  const declSet = new Set(topLevelDecls);

  // Component preference order.
  let component: string | null = null;
  if (declSet.has(expectedComponent)) component = expectedComponent;
  if (!component) {
    component =
      topLevelDecls.find(n => n.startsWith('Scene') && /[a-z]/.test(n) && !n.endsWith('Params')) ||
      null;
  }
  if (!component) {
    // Last-ditch: any PascalCase non-PARAMS identifier.
    component =
      topLevelDecls.find(
        n => /^[A-Z][a-zA-Z0-9]*$/.test(n) && /[a-z]/.test(n) && !/Params$/.test(n),
      ) || null;
  }

  // Params preference order.
  let params: string | null = null;
  if (declSet.has(expectedParams)) params = expectedParams;
  if (!params) {
    params = topLevelDecls.find(n => /Params$/.test(n)) || null;
  }

  return { component, params };
}

/**
 * Stitches per-scene TSX fragments into one self-contained
 * `GeneratedAsset` module. Each fragment is *expected* to define a
 * `Scene{N}Params` const + a `Scene{N}` component (per
 * SCENE_CODE_SYSTEM_PROMPT) but we never trust that contract — we
 * introspect each fragment (see `findSceneIdentifiers`) and reference
 * the names the LLM actually emitted. If a fragment defines no params
 * const, the spread for that scene is omitted; if it defines no
 * recognisable component, a no-op placeholder is rendered (so other
 * scenes still play).
 *
 * This is the TM-112 fix for the `ReferenceError: SceneNParams is not
 * defined` runtime crash that hit 5/5 multi-step cases in TM-108 r2.
 */
export function composeSceneCodes(
  outline: Outline,
  sceneCodes: string[],
  /** TM-90 — when present, surfaced as `PARAMS.imageUrl` so customize UI can swap. */
  imageUrl?: string | null,
): string {
  if (sceneCodes.length !== outline.scenes.length) {
    throw new Error(
      `TM-102 compose: scene code count ${sceneCodes.length} != outline ${outline.scenes.length}`,
    );
  }
  let offset = 0;
  const offsets: number[] = [];
  for (const s of outline.scenes) {
    offsets.push(offset);
    offset += s.durationInFrames;
  }

  // Discover identifiers per fragment. If the LLM drifted off the naming
  // contract we rename their decls to the canonical Scene{N}/Scene{N}Params
  // form so downstream wiring (Sequence + PARAMS spread) is uniform.
  const renamedFragments: string[] = [];
  const canonicalNames: { component: string; params: string | null }[] = [];
  for (let i = 0; i < sceneCodes.length; i++) {
    const n = i + 1;
    const expectedComponent = `Scene${n}`;
    const expectedParams = `Scene${n}Params`;
    const { component, params } = findSceneIdentifiers(sceneCodes[i], n);
    let frag = sceneCodes[i];
    // Rename component if present and not already canonical.
    if (component && component !== expectedComponent) {
      const re = new RegExp(`\\b${component}\\b`, 'g');
      frag = frag.replace(re, expectedComponent);
    }
    // Rename params if present and not already canonical.
    if (params && params !== expectedParams) {
      const re = new RegExp(`\\b${params}\\b`, 'g');
      frag = frag.replace(re, expectedParams);
    }
    renamedFragments.push(frag);
    canonicalNames.push({
      component: component ? expectedComponent : expectedComponent, // always render canonical; placeholder injected below if missing
      params: params ? expectedParams : null,
    });
    // If no component was discovered, append a tiny placeholder so the
    // <Sequence> still mounts something and the other scenes can render.
    // TM-116 — set displayName so dev console / EB componentStack shows
    // `<Scene{N}>` instead of `<Unknown>`.
    if (!component) {
      renamedFragments.push(
        `const ${expectedComponent} = () => <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;\n${expectedComponent}.displayName = ${JSON.stringify(expectedComponent)};`,
      );
    }
  }

  const fragments = renamedFragments.join('\n\n');

  const sequences = outline.scenes
    .map((s, i) => {
      const from = offsets[i];
      const dur = s.durationInFrames;
      const compName = canonicalNames[i].component;
      // TM-116 — wrap each scene in a per-scene boundary so one bad scene
      // doesn't tear down the whole asset and trip the studio EB. Without
      // this, a `<Scene1>` throw (e.g. undefined ref inside Scene1) bubbles
      // all the way up and the user sees a blank fallback instead of the
      // remaining scenes.
      return `      <Sequence from={${from}} durationInFrames={${dur}}><__SceneBoundary name=${JSON.stringify(compName)}><${compName} /></__SceneBoundary></Sequence>`;
    })
    .join('\n');

  // Merge per-scene params into top-level PARAMS via spread so the
  // customize UI auto-extract (ADR-0002) sees them in one place. Skip
  // any scene that didn't define a recognisable params const.
  const paramsSpreads = canonicalNames
    .map(c => (c.params ? `  ...${c.params},` : null))
    .filter((s): s is string => s !== null)
    .join('\n');

  // TM-90 — surface the asset-gen PNG URL on PARAMS so:
  //   (a) the customize UI auto-binds it as a `// type: text` field that
  //       users can swap for their own image, and
  //   (b) any scene that splices `<Img src={imageUrl} />` reads from a
  //       single source-of-truth field instead of a hardcoded literal.
  // The // type: text comment is required for ADR-0002 auto-extract.
  const imageUrlField = imageUrl
    ? `  imageUrl: ${JSON.stringify(imageUrl)}, // type: text\n`
    : '';

  // TM-116 — inline per-scene error boundary so a single scene's render
  // throw degrades to a silent transparent fill (other scenes still play)
  // instead of bubbling to the studio EvaluatorErrorBoundary. Defined
  // inside the factory body via the wrapper so it has access to React.
  return `${fragments}

class __SceneBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errored: false };
  }
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch(error, info) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[TM-116] scene render error in ' + (this.props.name || 'scene') + ':', error && error.message);
    }
  }
  render() {
    if (this.state.errored) {
      return <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;
    }
    return this.props.children;
  }
}

const PARAMS = {
${imageUrlField}${paramsSpreads}
} as const;

const GeneratedAsset = (_props: typeof PARAMS = PARAMS) => {
  return (
    <AbsoluteFill style={{ backgroundColor: ${JSON.stringify(outline.palette.background)} }}>
${sequences}
    </AbsoluteFill>
  );
};
GeneratedAsset.displayName = 'GeneratedAsset';
`;
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                       */
/* ------------------------------------------------------------------ */

export interface MultiStepResult {
  outline: Outline;
  sceneSpecs: SceneSpec[];
  composedCode: string;
  asset: GeneratedAsset;
  costRatio: number;
  costWarning: string | null;
  /** TM-90 — present when the asset-gen stage produced a PNG. */
  assetGen: AssetGenStageResult | null;
  /**
   * TM-124 — per-stage wall-clock timing so the studio UI can prove that
   * the multi-step pipeline actually ran (vs the single-shot fast path).
   * `mode` is always `multi-step` from `generateAssetMultiStep`; the
   * route-level adapter rewrites it to `single-shot` on fallback.
   */
  timing: PipelineTiming;
}

/**
 * TM-124 — execution trace surfaced to callers (route + UI dev badge).
 * The wire-format shape lives in `@/types` (client-safe re-export); this
 * type alias keeps server-side imports working unchanged.
 */
export type { PipelineTiming, PipelineTimingStage } from '@/types';

export interface MultiStepOptions {
  answers?: ClarifyAnswers;
  /** TM-90 — disable the asset-gen stage even when a living-entity hits.
   *  Useful for tests / cost-sensitive bench runs. */
  disableAssetGen?: boolean;
  /** TM-156 — propagate request id for structured stage marks. */
  __latencyReqId?: string;
}

export async function generateAssetMultiStep(
  prompt: string,
  model: string = getModels().pro,
  opts: MultiStepOptions = {},
): Promise<MultiStepResult> {
  // TM-124 — per-stage timing. Wall-clock per stage; gather time for
  // parallel stages (scene-spec || asset-gen, scene-code). `console.warn`
  // is dev-only (NODE_ENV !== production) so prod logs aren't polluted.
  const pipelineStart = Date.now();
  // TM-156 — request id for structured marks. Shared with route + asset-gen
  // so a single /api/generate call lights up the whole stack under one key.
  const __reqId = opts.__latencyReqId ?? newRequestId();
  const __profileOn = isLatencyProfileEnabled();
  const stages: PipelineTimingStage[] = [];
  const recordStage = (name: string, ms: number, meta?: Record<string, string | number | boolean>): void => {
    stages.push(meta ? { name, ms, meta } : { name, ms });
  };
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[pipeline] mode=multi-step stages=outline,scene-specs,asset-gen,scene-code,compose model=${model}`,
    );
  }

  // Stage 1 — outline. Asset-gen runs in parallel with scene-spec
  // (independent of both stages — only needs prompt + answers).
  // TM-139 — for character/scene prompts, force a ≥2-scene outline so the
  // multi-step branch actually exercises scene-level reasoning instead of
  // collapsing to single-shot equivalent (TM-124 RCA finding).
  const livingEntityHit = detectLivingEntity(prompt, opts.answers);
  const minScenes = livingEntityHit.matched ? 2 : 1;
  const outlineStart = Date.now();
  const outline = await generateOutline(prompt, model, { minScenes });
  const outlineMs = Date.now() - outlineStart;
  recordStage('outline', outlineMs, {
    scenes: outline.scenes.length,
    living_entity: livingEntityHit.matched,
    min_scenes: minScenes,
  });
  if (__profileOn) recordMark({ req: __reqId, phase: 'pipeline.outline', ms: outlineMs, meta: { scenes: outline.scenes.length, livingEntity: livingEntityHit.matched } });

  // TM-90 — kick off PNG generation in parallel with sceneSpecs. Even at the
  // worst case (gpt-image-1 ~10s @ low quality) this overlaps the spec stage
  // (gpt-4o ~3-5s × N parallel) so the wall-clock cost is ~max(spec, image)
  // not the sum. When opts.disableAssetGen or no living entity hits, this
  // resolves to null with zero API cost.
  const assetGenPromise: Promise<AssetGenStageResult | null> = opts.disableAssetGen
    ? Promise.resolve(null)
    : runAssetGenStage({ prompt, answers: opts.answers, __latencyReqId: __reqId }).catch((err) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[TM-90] asset-gen stage failed, continuing without PNG:',
            err instanceof Error ? err.message : String(err),
          );
        }
        return null;
      });

  // Run scene-spec calls in parallel — they only depend on the outline.
  const parallelStart = Date.now();
  const [sceneSpecs, assetGen] = await Promise.all([
    Promise.all(outline.scenes.map((_, i) => generateSceneSpec(outline, i, model))),
    assetGenPromise,
  ]);
  const parallelMs = Date.now() - parallelStart;
  recordStage('scene-specs+asset-gen', parallelMs, {
    sceneSpecs: outline.scenes.length,
    assetGenUsed: assetGen != null,
    assetGenCached: assetGen?.cached ?? false,
  });
  if (__profileOn) recordMark({
    req: __reqId,
    phase: 'pipeline.scene-specs+asset-gen',
    ms: parallelMs,
    meta: { scenes: outline.scenes.length, assetGenUsed: assetGen != null, assetGenCached: assetGen?.cached ?? null, assetGenLatencyMs: assetGen?.latencyMs ?? null },
  });
  const imageUrl = assetGen?.imageUrl ?? null;
  // Code calls also parallel — each depends only on its own spec + the outline.
  const sceneCodeStart = Date.now();
  const sceneCodes = await Promise.all(
    sceneSpecs.map((spec, i) => generateSceneCode(outline, spec, i, model, imageUrl)),
  );
  const sceneCodeMs = Date.now() - sceneCodeStart;
  recordStage('scene-code', sceneCodeMs, { count: sceneCodes.length });
  if (__profileOn) recordMark({ req: __reqId, phase: 'pipeline.scene-code', ms: sceneCodeMs, meta: { count: sceneCodes.length } });

  // TM-117 — per-scene transpile precheck. Even after TM-111 / TM-114 /
  // TM-116 sanitisation, gpt-4o occasionally emits a fragment that survives
  // the validator but trips sucrase at the composition stage (e.g. TM-108
  // r5 case 1 `Unexpected token, expected "(" (1:46)`). Without this guard
  // the whole pipeline 500s on a single bad scene. We probe each fragment
  // independently and substitute a displayName-bearing placeholder for any
  // fragment sucrase rejects so the remaining scenes still play.
  const prechecked = await Promise.all(
    sceneCodes.map(async (frag, i) => {
      try {
        // sucrase needs the same TS/JSX transforms the composed module gets.
        await transpileTSX(frag);
        return frag;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[TM-117] scene-code[${i}] failed transpile precheck — substituting placeholder: ${msg}`);
        }
        const n = i + 1;
        // Placeholder that satisfies findSceneIdentifiers + supplies a
        // displayName so the studio EB componentStack shows `<Scene{N}>`
        // rather than `<Unknown>`. Defensive parity with the missing-component
        // branch inside composeSceneCodes.
        return `const Scene${n}Params = {};\nconst Scene${n} = () => <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;\nScene${n}.displayName = ${JSON.stringify(`Scene${n}`)};`;
      }
    }),
  );

  const composeStart = Date.now();
  const composedCode = composeSceneCodes(outline, prechecked, imageUrl);

  // TM-111 — apply forbidden-token sanitizer to the COMPOSED module too,
  // so any token introduced by the wrapper (or surviving sub-fragments)
  // is scrubbed before the final validator runs.
  const { code: composedScrubbed, notes: composeNotes } = sanitizeForbiddenTokens(composedCode);
  if (composeNotes.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn('[TM-111] composed code auto-sanitized:', composeNotes);
  }

  // Validate the composed module as a whole.
  const validation = validateCode(composedScrubbed);
  if (!validation.valid) {
    throw new Error(
      `TM-102 composed code failed sandbox validation after TM-111 sanitize: ${validation.errors.join(', ')}`,
    );
  }
  const sanitized = sanitizeCode(composedScrubbed);
  const jsCode = await transpileTSX(sanitized);
  const parameters = extractParameters(composedScrubbed);

  const asset: GeneratedAsset = {
    id: crypto.randomUUID(),
    title: outline.title,
    // TM-111: persist the SCRUBBED composed source so re-renders/edits
    // operate on code that already passes the sandbox validator.
    code: composedScrubbed,
    jsCode,
    parameters,
    durationInFrames: outline.totalDurationInFrames,
    fps: outline.fps,
    width: outline.width,
    height: outline.height,
  };

  const costRatio = projectedMultiStepCostRatio(outline.scenes.length);
  const costWarning =
    costRatio >= MULTI_STEP_COST_RATIO_WARN
      ? `Multi-step generation projected to consume ~${costRatio.toFixed(1)}× the tokens of a single-shot run for this prompt (${outline.scenes.length} scenes). Set AI_MULTI_STEP=0 to fall back to single-shot.`
      : null;

  const composeMs = Date.now() - composeStart;
  recordStage('compose+validate', composeMs, {
    composedChars: composedScrubbed.length,
  });
  if (__profileOn) recordMark({ req: __reqId, phase: 'pipeline.compose+validate', ms: composeMs, meta: { composedChars: composedScrubbed.length } });

  const totalMs = Date.now() - pipelineStart;
  if (__profileOn) recordMark({ req: __reqId, phase: 'pipeline.total', ms: totalMs, meta: { scenes: outline.scenes.length, assetGenUsed: assetGen != null } });
  const timing: PipelineTiming = {
    mode: 'multi-step',
    stages,
    totalMs,
    asset_gen_used: assetGen != null,
    scenes: outline.scenes.length,
  };
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[pipeline] done mode=multi-step totalMs=${totalMs} scenes=${outline.scenes.length} assetGen=${assetGen != null ? (assetGen.cached ? 'cached' : 'fresh') : 'none'}`,
    );
    for (const s of stages) {
      console.warn(`[pipeline]   stage=${s.name} ms=${s.ms}${s.meta ? ' ' + JSON.stringify(s.meta) : ''}`);
    }
  }

  return {
    outline,
    sceneSpecs,
    composedCode: composedScrubbed,
    asset,
    costRatio,
    costWarning,
    assetGen,
    timing,
  };
}

/**
 * Convenience wrapper that adapts the multi-step result to the same
 * `GenerateApiResponse` shape the route handler returns from
 * `generateAsset`. Kept here so callers can swap one for the other.
 */
export async function generateAssetMultiStepAsApiResponse(
  prompt: string,
  model?: string,
  opts: MultiStepOptions = {},
  // TM-156 — req id kept inside opts; method signature unchanged.
): Promise<GenerateApiResponse & {
  multiStep?: {
    costRatio: number;
    fallback?: 'single-shot';
    assetGen?: { imageUrl: string; cached: boolean; costUsd: number };
  };
  /** TM-124 — per-stage timing trace surfaced for the studio dev badge. */
  assetGenStages?: PipelineTiming;
}> {
  try {
    const result = await generateAssetMultiStep(prompt, model, opts);
    return {
      type: 'generate',
      asset: result.asset,
      ...(result.costWarning ? { warning: result.costWarning } : {}),
      multiStep: {
        costRatio: result.costRatio,
        ...(result.assetGen
          ? { assetGen: { imageUrl: result.assetGen.imageUrl, cached: result.assetGen.cached, costUsd: result.assetGen.costUsd } }
          : {}),
      },
      assetGenStages: result.timing,
    };
  } catch (err) {
    // TM-111 — single-shot fallback for any sandbox / transpile / structural
    // failure inside the multi-step pipeline. Rationale (TM-108): gpt-4o
    // emits Forbidden tokens in 4/5 cases; sanitizer catches most but not
    // all. Rather than 500 the user, retry on the proven single-shot path.
    const message = err instanceof Error ? err.message : String(err);
    const isPipelineFailure =
      err instanceof SceneSandboxError ||
      /TM-102|sandbox validation|failed to transpile|did not return valid JSON/i.test(message);
    if (!isPipelineFailure) throw err;
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-111] multi-step pipeline failed, falling back to single-shot:',
        message,
      );
    }
    // Dynamic import to avoid a circular dep with generate.ts.
    const { generateAsset } = await import('./generate');
    // Force the single-shot path by clearing the AI_MULTI_STEP flag for
    // this call only (process.env mutation in Node is process-local).
    const prev = process.env.AI_MULTI_STEP;
    process.env.AI_MULTI_STEP = '0';
    const fallbackStart = Date.now();
    try {
      const fallback = await generateAsset(prompt, model);
      const fallbackMs = Date.now() - fallbackStart;
      const fallbackTiming: PipelineTiming = {
        mode: 'single-shot',
        stages: [{ name: 'single-shot-fallback', ms: fallbackMs, meta: { reason: message.slice(0, 120) } }],
        totalMs: fallbackMs,
        asset_gen_used: false,
        scenes: 0,
      };
      const fallbackWarning =
        `TM-111: multi-step pipeline failed (${message.split('\n')[0].slice(0, 160)}); served single-shot result.`;
      if (fallback.type === 'generate') {
        return {
          ...fallback,
          warning: fallback.warning ? `${fallback.warning} | ${fallbackWarning}` : fallbackWarning,
          multiStep: { costRatio: 1, fallback: 'single-shot' },
          assetGenStages: fallbackTiming,
        };
      }
      // Clarify fallback — surface as-is (no warning slot in clarify shape).
      return { ...fallback, multiStep: { costRatio: 1, fallback: 'single-shot' }, assetGenStages: fallbackTiming };
    } finally {
      if (prev === undefined) delete process.env.AI_MULTI_STEP;
      else process.env.AI_MULTI_STEP = prev;
    }
  }
}
