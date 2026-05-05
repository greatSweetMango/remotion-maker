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
import type { GeneratedAsset, GenerateApiResponse } from '@/types';

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

  // 1. `const X = require('...')` / `const { a } = require('...')` —
  //    drop the whole declaration. Remotion runtime injects all
  //    React/Remotion globals so a CJS require is never legitimate.
  const requireDecl = /^[ \t]*(?:const|let|var)\s+[^;\n]*=\s*require\s*\([^)]*\)\s*;?\s*$/gm;
  if (requireDecl.test(code)) {
    code = code.replace(requireDecl, '');
    notes.push('stripped `const … = require(...)` declarations');
  }
  // Bare `require(...)` calls anywhere → comment out the rest of the line.
  const bareRequire = /\brequire\s*\([^)]*\)/g;
  if (bareRequire.test(code)) {
    code = code.replace(bareRequire, 'undefined /* TM-111: require stripped */');
    notes.push('replaced bare require(...) with undefined');
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

export async function generateOutline(prompt: string, model: string): Promise<Outline> {
  // TM-104 — extract duration hint up-front so we can:
  //   (a) inject a hard directive into the outline prompt,
  //   (b) post-fix the LLM result if it ignores the directive.
  const hint = extractDurationHint(prompt);
  let userMessage = prompt;
  let plan: ReturnType<typeof planSceneDurations> | null = null;
  if (hint.seconds && hint.seconds > 10) {
    plan = planSceneDurations(hint.seconds, DEFAULT_FPS);
    const directive =
      `\n\n---\nDURATION DIRECTIVE (TM-104): The user asked for a ~${hint.seconds}s video. ` +
      `Target totalDurationInFrames=${plan.totalFrames} at fps=${plan.fps}. ` +
      `Use ${plan.sceneFrames.length} scenes with durations [${plan.sceneFrames.join(', ')}] frames respectively.`;
    userMessage = prompt + directive;
  }
  const text = await chatComplete({
    model,
    system: OUTLINE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  const parsed = extractJsonObject(text);
  if (!parsed) throw new Error('TM-102 outline: AI did not return valid JSON');
  const outline = validateOutline(parsed);
  // Post-fix: if the LLM ignored the duration directive, force the plan.
  if (plan && Math.abs(outline.totalDurationInFrames - plan.totalFrames) > plan.fps) {
    return enforceScenePlan(outline, plan);
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
    },
    null,
    2,
  );
  const text = await chatComplete({
    model,
    system: SCENE_CODE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPayload }],
  });
  const parsed = extractJsonObject(text);
  if (!parsed) {
    throw new Error(`TM-102 scene-code[${sceneIdx}]: AI did not return valid JSON`);
  }
  const rawCode = parsed.code as string | undefined;
  if (!rawCode || rawCode.trim().length < 100) {
    throw new Error(`TM-102 scene-code[${sceneIdx}]: too short or missing`);
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
export function composeSceneCodes(outline: Outline, sceneCodes: string[]): string {
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
    if (!component) {
      renamedFragments.push(
        `const ${expectedComponent} = () => <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;`,
      );
    }
  }

  const fragments = renamedFragments.join('\n\n');

  const sequences = outline.scenes
    .map((s, i) => {
      const from = offsets[i];
      const dur = s.durationInFrames;
      const compName = canonicalNames[i].component;
      return `      <Sequence from={${from}} durationInFrames={${dur}}><${compName} /></Sequence>`;
    })
    .join('\n');

  // Merge per-scene params into top-level PARAMS via spread so the
  // customize UI auto-extract (ADR-0002) sees them in one place. Skip
  // any scene that didn't define a recognisable params const.
  const paramsSpreads = canonicalNames
    .map(c => (c.params ? `  ...${c.params},` : null))
    .filter((s): s is string => s !== null)
    .join('\n');

  return `${fragments}

const PARAMS = {
${paramsSpreads}
} as const;

const GeneratedAsset = (_props: typeof PARAMS = PARAMS) => {
  return (
    <AbsoluteFill style={{ backgroundColor: ${JSON.stringify(outline.palette.background)} }}>
${sequences}
    </AbsoluteFill>
  );
};
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
}

export async function generateAssetMultiStep(
  prompt: string,
  model: string = getModels().pro,
): Promise<MultiStepResult> {
  const outline = await generateOutline(prompt, model);

  // Run scene-spec calls in parallel — they only depend on the outline.
  const sceneSpecs = await Promise.all(
    outline.scenes.map((_, i) => generateSceneSpec(outline, i, model)),
  );
  // Code calls also parallel — each depends only on its own spec + the outline.
  const sceneCodes = await Promise.all(
    sceneSpecs.map((spec, i) => generateSceneCode(outline, spec, i, model)),
  );

  const composedCode = composeSceneCodes(outline, sceneCodes);

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

  return { outline, sceneSpecs, composedCode: composedScrubbed, asset, costRatio, costWarning };
}

/**
 * Convenience wrapper that adapts the multi-step result to the same
 * `GenerateApiResponse` shape the route handler returns from
 * `generateAsset`. Kept here so callers can swap one for the other.
 */
export async function generateAssetMultiStepAsApiResponse(
  prompt: string,
  model?: string,
): Promise<GenerateApiResponse & { multiStep?: { costRatio: number; fallback?: 'single-shot' } }> {
  try {
    const result = await generateAssetMultiStep(prompt, model);
    return {
      type: 'generate',
      asset: result.asset,
      ...(result.costWarning ? { warning: result.costWarning } : {}),
      multiStep: { costRatio: result.costRatio },
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
    try {
      const fallback = await generateAsset(prompt, model);
      const fallbackWarning =
        `TM-111: multi-step pipeline failed (${message.split('\n')[0].slice(0, 160)}); served single-shot result.`;
      if (fallback.type === 'generate') {
        return {
          ...fallback,
          warning: fallback.warning ? `${fallback.warning} | ${fallbackWarning}` : fallbackWarning,
          multiStep: { costRatio: 1, fallback: 'single-shot' },
        };
      }
      // Clarify fallback — surface as-is (no warning slot in clarify shape).
      return { ...fallback, multiStep: { costRatio: 1, fallback: 'single-shot' } };
    } finally {
      if (prev === undefined) delete process.env.AI_MULTI_STEP;
      else process.env.AI_MULTI_STEP = prev;
    }
  }
}
