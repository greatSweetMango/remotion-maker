import { chatComplete, chatCompleteStream, getModels } from './client';
import {
  GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
  GENERATION_NON_EMPTY_REINFORCEMENT,
  GENERATION_NON_EMPTY_REINFORCEMENT_STRICT,
  buildTranspileRetryReinforcement,
} from './prompts';
import {
  scoreConcreteness,
  FORCE_GENERATE_REINFORCEMENT,
  FORCE_GENERATE_DATAVIZ_REINFORCEMENT,
  buildEntityCountReinforcement,
} from './clarify-gate';
import { generateClarifyQuestions } from './clarify-questions';
import { extractParameters } from './extract-params';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import { classifyRefusal, AiRefusalError } from './refusal';
import {
  retrieveReferenceForPrompt,
  retrieveForcedReferenceForPrompt,
  readTemplateSource,
} from './retrieval';
import {
  runAssetGenStage,
  detectLivingEntity,
  ASSET_GEN_DIR_REL,
  type AssetGenStageResult,
} from './asset-gen-stage';
import {
  runSpriteSheetStage,
  type SpriteSheetStageResult,
} from './sprite-sheet-stage';
import {
  judgeAndMaybeRegenerate,
  isSelfCritiqueEnabled,
  type SelfCritiqueResult,
} from './self-critique';
import path from 'node:path';
import type { GeneratedAsset, GenerateApiResponse, ClarifyAnswers, ClarifyQuestion } from '@/types';

export interface GenerateOptions {
  /** When provided, prior clarify answers are appended so LLM forces mode=generate. */
  answers?: ClarifyAnswers;
  /**
   * TM-54 — fired when the model emits its first token. Lets callers
   * record TTFB independently of full-asset wall time.
   */
  onFirstToken?: (msSinceStart: number) => void;
  /** TM-54 — fired on every text delta from the LLM stream. */
  onDelta?: (chunk: string, sofar: string) => void;
  /**
   * TM-136 — escape hatch to opt-out of the single-shot asset-gen branch.
   * Tests / cost-sensitive bench runs set this to true to skip gpt-image-1
   * even when a living-entity prompt would otherwise trigger it. Default
   * = false (asset-gen runs whenever a living-entity hits).
   */
  disableAssetGen?: boolean;
  /**
   * TM-136 — test seam. Lets unit tests inject a stubbed `runAssetGenStage`
   * implementation so they don't hit OpenAI / the filesystem. When omitted,
   * the real `runAssetGenStage` is used.
   */
  __assetGenStage?: typeof runAssetGenStage;
  /**
   * TM-138 — test seam for the vision-guided self-critique loop. When
   * present, replaces `judgeAndMaybeRegenerate` so unit tests can stub
   * the judge + regen path. Production code uses the default.
   */
  __selfCritique?: typeof judgeAndMaybeRegenerate;
  /**
   * TM-142 — opt-in sprite-sheet pipeline. When true (or when the
   * `AI_SPRITE_SHEET=1` env flag is set), the single-shot path runs the
   * 4-frame sprite-sheet stage INSTEAD OF the single-PNG asset-gen
   * stage. Living-entity detection still gates whether the stage fires
   * at all. Disabled by default — costs ~$0.16/first-gen vs ~$0.04 for
   * single-PNG, so feature stays opt-in until visual-quality bench
   * justifies the default flip.
   */
  enableSpriteSheet?: boolean;
  /** TM-142 — test seam mirroring `__assetGenStage`. */
  __spriteSheetStage?: typeof runSpriteSheetStage;
}

export interface GenerateLatency {
  firstTokenMs: number;
  totalMs: number;
}

/**
 * TM-51 placeholder/empty-body guard.
 *
 * QA found that gpt-4o (PRO tier) sometimes returned a 25-char stub
 * `const Component = () => null;` — passes sandbox validation but renders
 * a blank screen. We post-validate by structure rather than length alone.
 *
 * Returns a list of human-readable reasons; empty list means the code is
 * acceptable. Caller decides whether to retry or surface an error.
 *
 * Heuristics (any one match → reject):
 *   - Code shorter than MIN_CODE_LENGTH (200 chars by observation)
 *   - No `const PARAMS` definition
 *   - No JSX-like content (no `<` followed by capital letter or AbsoluteFill)
 *   - Body resolves to `() => null` / `() => null;`
 */
export const PLACEHOLDER_MIN_CODE_LENGTH = 200;

export function detectPlaceholderCode(code: string): string[] {
  const reasons: string[] = [];
  const trimmed = (code ?? '').trim();

  if (trimmed.length < PLACEHOLDER_MIN_CODE_LENGTH) {
    reasons.push(`code too short (${trimmed.length} < ${PLACEHOLDER_MIN_CODE_LENGTH} chars)`);
  }
  // PARAMS export is required by ADR-0002.
  if (!/\bconst\s+PARAMS\s*=/.test(trimmed)) {
    reasons.push('missing `const PARAMS = ...` declaration');
  }
  // Must have substantive JSX. Any `<Capital` or `<Absolute` tag counts.
  // Avoid matching just `<` in comparisons (e.g. `frame < 30`).
  if (!/<[A-Z][A-Za-z0-9]*[\s/>]/.test(trimmed) && !/<AbsoluteFill\b/.test(trimmed)) {
    reasons.push('no JSX element found (component must render something)');
  }
  // Reject explicit `() => null` arrow body for the component (the canonical
  // stub from TM-41 QA). We allow `=> null` elsewhere as long as overall code
  // is substantive and other checks pass — but the canonical pattern is
  // always rejected.
  if (/=>\s*null\s*[;\n)}]/.test(trimmed) && trimmed.length < 400) {
    reasons.push('component body is `() => null` placeholder');
  }
  // Skeleton echo — model copied the system-prompt's template comments
  // verbatim instead of writing real code. Discovered with the "곰돌이가 초원을
  // 걷는 애니메이션" prompt: model emitted `// Complete TSX code here` +
  // `{/* component content */}` + generic `text: "Hello World"` defaults.
  // Length / PARAMS / JSX guards all passed because the skeleton looks valid.
  if (/\/\/\s*Complete\s+TSX\s+code\s+here/i.test(trimmed)) {
    reasons.push('skeleton comment `// Complete TSX code here` left in code');
  }
  if (/\{\s*\/\*\s*component\s+content\s*\*\/\s*\}/i.test(trimmed)) {
    reasons.push('empty JSX placeholder `{/* component content */}` left in code');
  }
  if (/\/\/\s*\.\.\.\s*all\s+params/i.test(trimmed)) {
    reasons.push('skeleton comment `// ... all params` left in code');
  }
  if (/\/\/\s*animation\s+logic\s*$/im.test(trimmed)) {
    reasons.push('skeleton comment `// animation logic` left in code');
  }
  return reasons;
}

/**
 * Repair an LLM payload where a JSON string value was emitted with JS template-literal
 * backticks instead of double quotes (a frequent failure mode on smaller models).
 * We rewrite `…` segments at JSON value positions into properly escaped "…" strings.
 *
 * Heuristic: find sequences of `:` followed by optional whitespace + a backtick-delimited
 * span at top level (not inside a JSON "..." string) and convert them.
 */
function repairBacktickStrings(input: string): string {
  let out = '';
  let i = 0;
  let inJsonString = false;
  let escape = false;
  while (i < input.length) {
    const ch = input[i];
    if (inJsonString) {
      out += ch;
      if (escape) { escape = false; }
      else if (ch === '\\') { escape = true; }
      else if (ch === '"') { inJsonString = false; }
      i++;
      continue;
    }
    if (ch === '"') { inJsonString = true; out += ch; i++; continue; }
    if (ch === '`') {
      // Walk to matching backtick. Convert contents to a JSON string literal.
      let j = i + 1;
      let body = '';
      while (j < input.length && input[j] !== '`') {
        body += input[j];
        j++;
      }
      if (j >= input.length) { out += ch; i++; continue; } // unbalanced
      const escaped = body
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      out += '"' + escaped + '"';
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * TM-53 — strip trailing commas inside arrays/objects that some smaller
 * models (notably gpt-4o-mini) emit even when JSON mode is on. We only
 * strike `,` characters that sit immediately before `}` or `]` and are
 * NOT inside a JSON string literal.
 */
export function repairTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === ',') {
      // Look ahead past whitespace for closing bracket.
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '}' || input[j] === ']') continue; // drop comma
    }
    out += ch;
  }
  return out;
}

/**
 * TM-53 — normalize smart / curly quotes to straight ASCII quotes. gpt-4o-mini
 * sometimes auto-corrects nested string punctuation (e.g. the literal
 * `"Loading 42%"` substring inside the prompt comes back as
 * `“Loading 42%”`) which then break `JSON.parse` further downstream.
 * Strict-mode JSON requires straight quotes; this pass leaves regular ASCII
 * quotes alone so it is safe to run unconditionally before `JSON.parse`.
 */
export function repairSmartQuotes(input: string): string {
  return input
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/[‘’‚‛′‵]/g, "'");
}

/**
 * Extract first balanced JSON object from raw LLM text.
 * Tolerates leading prose / code fences and backtick-quoted string values.
 * Returns null on failure.
 *
 * Repair ladder (TM-53):
 *  1. raw `JSON.parse`
 *  2. backtick-quoted string values  → "..."
 *  3. trailing-comma strip + smart-quote normalize
 *  4. all of the above combined
 */
export function extractJson(text: string): unknown | null {
  // Strip code fences first
  const fenceStripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const start = fenceStripped.indexOf('{');
  if (start < 0) return null;
  // Walk to find matching brace. Track JSON string state AND backtick state so that
  // braces inside a backtick-wrapped (template-literal) value don't bias depth.
  let depth = 0;
  let inString = false;
  let inBacktick = false;
  let escape = false;
  let endIdx = -1;
  for (let i = start; i < fenceStripped.length; i++) {
    const ch = fenceStripped[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (!inBacktick && ch === '"') { inString = !inString; continue; }
    if (!inString && ch === '`') { inBacktick = !inBacktick; continue; }
    if (inString || inBacktick) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx < 0) return null;
  const slice = fenceStripped.slice(start, endIdx + 1);
  // Ladder of progressively more aggressive repairs (TM-53). Each layer is
  // independently safe; we just try them in turn so the cheapest parse wins.
  const candidates: string[] = [
    slice,
    repairBacktickStrings(slice),
    repairTrailingCommas(repairSmartQuotes(slice)),
    repairTrailingCommas(repairSmartQuotes(repairBacktickStrings(slice))),
  ];
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

function buildUserMessage(prompt: string, answers?: ClarifyAnswers): string {
  if (!answers || Object.keys(answers).length === 0) return prompt;
  const formatted = Object.entries(answers)
    .map(([qid, choiceId]) => `  - ${qid}: ${choiceId}`)
    .join('\n');
  return `${prompt}\n\n[USER ANSWERS]\n${formatted}`;
}

/**
 * Single LLM call + extract+validate. Returns either a structured response
 * (`{ kind: 'response', value }`) or a soft failure (`{ kind: 'placeholder', reasons }`)
 * that the caller may retry. Hard failures (no JSON, security violation,
 * missing questions) are thrown.
 */
async function generateOnce(
  prompt: string,
  model: string,
  opts: GenerateOptions,
  systemPrompt: string,
): Promise<
  | { kind: 'response'; value: GenerateApiResponse & { latency?: GenerateLatency } }
  | { kind: 'placeholder'; reasons: string[]; rawCode: string }
  | { kind: 'transpile_error'; rawCode: string; errorMessage: string }
> {
  const userContent = buildUserMessage(prompt, opts.answers);

  // TM-54 — when the caller wants TTFB observability we go through the
  // streaming path. Otherwise fall back to `chatComplete` so existing
  // tests that mock it keep working untouched.
  let text: string;
  let latency: GenerateLatency | undefined;
  if (opts.onFirstToken || opts.onDelta) {
    const result = await chatCompleteStream({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      onFirstToken: opts.onFirstToken,
      onDelta: opts.onDelta,
    });
    text = result.text;
    latency = { firstTokenMs: result.firstTokenMs, totalMs: result.totalMs };
  } else {
    text = await chatComplete({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
  }

  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    // TM-59 — when the LLM refuses an adversarial / unsafe prompt it tends
    // to emit prose ("I'm sorry, I can't help with that.") instead of the
    // requested JSON. Reflect the actual cause to the user rather than the
    // misleading "AI did not return valid JSON".
    const classification = classifyRefusal(text);
    if (classification.category !== 'unknown') {
      throw new AiRefusalError(classification);
    }
    throw new Error('AI did not return valid JSON');
  }

  const obj = parsed as Record<string, unknown>;
  const mode = obj.mode;

  if (mode === 'clarify') {
    const questions = obj.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('AI clarify response missing questions');
    }
    return {
      kind: 'response',
      value: {
        type: 'clarify',
        questions: questions as ClarifyQuestion[],
        ...(latency ? { latency } : {}),
      },
    };
  }

  // mode === 'generate' (or omitted — default to generate path for backward compat)
  const code = obj.code as string | undefined;
  if (!code) throw new Error('AI generate response missing code');

  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(`Generated code failed security check: ${validation.errors.join(', ')}`);
  }

  // TM-51: post-validate for placeholder/empty-body stubs (gpt-4o failure mode).
  const placeholderReasons = detectPlaceholderCode(code);
  if (placeholderReasons.length > 0) {
    return { kind: 'placeholder', reasons: placeholderReasons, rawCode: code };
  }

  const sanitized = sanitizeCode(code);
  // TM-67: detect transpile (sucrase) failures and surface them as a soft
  // failure so the caller can retry with a syntax-correctness reinforcement.
  let jsCode: string;
  try {
    jsCode = await transpileTSX(sanitized);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { kind: 'transpile_error', rawCode: code, errorMessage };
  }
  const parameters = extractParameters(code);

  const asset: GeneratedAsset = {
    id: crypto.randomUUID(),
    title: (obj.title as string) ?? 'Untitled',
    code,
    jsCode,
    parameters,
    durationInFrames: (obj.durationInFrames as number) || 150,
    fps: (obj.fps as number) || 30,
    width: (obj.width as number) || 1920,
    height: (obj.height as number) || 1080,
  };

  return {
    kind: 'response',
    value: { type: 'generate', asset, ...(latency ? { latency } : {}) },
  };
}

/**
 * TM-136 — system-prompt addendum injected when an asset-gen PNG is
 * available for the current prompt. Tells the LLM that a pre-generated
 * character/animal/person image lives at `PARAMS.imageUrl` and that it
 * should splice it via `<Img src={PARAMS.imageUrl} />` instead of trying
 * to draw the figure with primitives (the failure mode that ships
 * "갈색 원" instead of a bear — see TM-135 RCA).
 *
 * Cache stability (ADR-0003): we APPEND this block to the base system
 * prompt verbatim; cache key remains stable across (prompt, has-image)
 * variants because the addendum is suffix-only.
 */
export const ASSET_GEN_SYSTEM_PROMPT_ADDENDUM = `

============== ASSET-GEN IMAGE AVAILABLE (TM-136) ==============

A pre-generated PNG of the prompt's character/animal/person SUBJECT is
available at \`PARAMS.imageUrl\`. You MUST:

  1. Add \`imageUrl: "<provided>"\` to the PARAMS const annotated with
     \`// type: text\` so the customize UI can swap it.
  2. Render the subject via \`<Img src={PARAMS.imageUrl}
     style={{ position: 'absolute', width, height, objectFit: 'contain' }} />\`
     positioned inside the AbsoluteFill. Do NOT attempt to draw the
     subject from <div>/SVG primitives — the PNG is the visual.
  3. Animate position / scale / opacity AROUND the <Img> (e.g. translateX
     for a horizontal scroll, spring on scale, opacity fade) using the
     standard interpolate/spring helpers. The Img component is a Remotion
     global — no import needed.

The exact imageUrl string will be substituted server-side after you
respond, so emit \`imageUrl: "TM136_IMAGE_URL_PLACEHOLDER", // type: text\`
verbatim and we will rewrite it.
`;

/**
 * TM-136 — substitute the LLM's placeholder string with the real asset-gen
 * URL, AND back-fill a PARAMS.imageUrl entry if the LLM forgot to add one.
 * Returns the rewritten code; never throws.
 *
 * Strategy:
 *   1. If the placeholder \`TM136_IMAGE_URL_PLACEHOLDER\` is present,
 *      replace every occurrence with the real URL (handles single OR
 *      double-quote literals).
 *   2. If no \`imageUrl\` field exists in PARAMS at all (LLM ignored the
 *      addendum), inject one as the first field of the PARAMS object.
 *      We deliberately do NOT also inject the <Img> usage — when the LLM
 *      ignored the addendum, the imageUrl entry is at least surfaced in
 *      the customize UI so the user can see the asset and the next edit
 *      round can pick it up.
 */
export function injectAssetImageUrl(code: string, imageUrl: string): string {
  let out = code;

  // 1. Replace placeholder occurrences (the canonical happy path).
  if (out.includes('TM136_IMAGE_URL_PLACEHOLDER')) {
    out = out.replace(/TM136_IMAGE_URL_PLACEHOLDER/g, imageUrl);
    return out;
  }

  // 2. Back-fill: PARAMS exists but no imageUrl key. Inject as first field.
  // Detect ` imageUrl:` already present (any whitespace) → bail.
  if (/\bimageUrl\s*:/.test(out)) {
    return out;
  }
  // Match `const PARAMS = {` followed by optional newline.
  const paramsRe = /(const\s+PARAMS\s*=\s*\{)([\s\S]*?)(\}\s*(?:as\s+const)?)/;
  const m = out.match(paramsRe);
  if (!m) return out; // no PARAMS — placeholder/empty handler will catch it
  const [, head, body, tail] = m;
  const safeUrl = JSON.stringify(imageUrl);
  const injectedField = `\n  imageUrl: ${safeUrl}, // type: text`;
  // Place the new field as the FIRST field so it renders at the top of the
  // customize panel — most prominent slot for user-replaceable assets.
  const newBody = injectedField + (body.startsWith('\n') ? body : '\n' + body);
  out = out.replace(paramsRe, `${head}${newBody}${tail}`);
  return out;
}

/**
 * TM-142 — system-prompt addendum for the 4-frame walk-cycle pipeline.
 *
 * Replaces the single-image addendum when `enableSpriteSheet`/AI_SPRITE_SHEET=1
 * is active. Tells the LLM to use `<SpriteAnimator frames={PARAMS.spriteFrames}>`
 * instead of `<Img src={PARAMS.imageUrl}>` so the subject actually walks.
 *
 * Cache stability (ADR-0003): suffix-only block, swappable with the
 * single-image addendum without changing the base prompt cache prefix.
 */
export const SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM = `

============== SPRITE-SHEET WALK-CYCLE AVAILABLE (TM-142) ==============

A pre-generated 4-frame walk-cycle sprite sheet of the prompt's
character/animal/person SUBJECT is available at \`PARAMS.spriteFrames\`
(an array of 4 PNG URLs in walk-cycle order). You MUST:

  1. Add \`spriteFrames: ["TM142_SPRITE_FRAMES_PLACEHOLDER"]\` verbatim to
     the PARAMS const annotated with \`// type: text\`. The placeholder
     will be replaced server-side with the real 4-URL array.
  2. Render the subject via
     \`<SpriteAnimator frames={PARAMS.spriteFrames} fps={8}
        style={{ position: 'absolute', width, height, objectFit: 'contain' }} />\`
     positioned inside the AbsoluteFill. Do NOT attempt to draw the
     subject from <div>/SVG primitives — the sprite sheet is the visual.
  3. Animate position (translateX for walking across the screen, etc.)
     AROUND the <SpriteAnimator> using the standard interpolate/spring
     helpers. The component cycles internally; you only animate where
     the subject MOVES, not its leg poses.

The SpriteAnimator component is a sandbox-injected global — no import
needed. The exact spriteFrames array will be substituted server-side
after you respond, so emit the placeholder verbatim.
`;

/**
 * TM-142 — inject the sprite-frame URLs into PARAMS.spriteFrames.
 *
 * Mirrors `injectAssetImageUrl`:
 *   1. Replace the literal placeholder array element with the real URLs.
 *   2. If no `spriteFrames` field exists at all (LLM ignored the
 *      addendum), back-fill one as the first PARAMS field so the
 *      customize UI at least surfaces the asset.
 */
export function injectSpriteFrames(code: string, frames: string[]): string {
  const safeFrames = JSON.stringify(frames);

  // 1. Replace the placeholder array form
  // `["TM142_SPRITE_FRAMES_PLACEHOLDER"]` with the real array. Tolerate
  // single OR double quotes and inner whitespace.
  const placeholderRe =
    /\[\s*["']TM142_SPRITE_FRAMES_PLACEHOLDER["']\s*\]/g;
  if (placeholderRe.test(code)) {
    return code.replace(placeholderRe, safeFrames);
  }

  // 2. Back-fill: PARAMS exists but no spriteFrames key.
  if (/\bspriteFrames\s*:/.test(code)) return code;
  const paramsRe = /(const\s+PARAMS\s*=\s*\{)([\s\S]*?)(\}\s*(?:as\s+const)?)/;
  const m = code.match(paramsRe);
  if (!m) return code;
  const [, head, body, tail] = m;
  const injectedField = `\n  spriteFrames: ${safeFrames}, // type: text`;
  const newBody = injectedField + (body.startsWith('\n') ? body : '\n' + body);
  return code.replace(paramsRe, `${head}${newBody}${tail}`);
}

/**
 * TM-142 — env helper. The single-shot path consults this to decide
 * whether to swap asset-gen for sprite-sheet. Kept as a tiny helper so
 * tests can stub `process.env.AI_SPRITE_SHEET` without re-importing.
 */
export function isSpriteSheetEnabled(opts: GenerateOptions): boolean {
  if (opts.enableSpriteSheet) return true;
  return process.env.AI_SPRITE_SHEET === '1';
}

export async function generateAsset(
  prompt: string,
  model: string = getModels().free,
  opts: GenerateOptions = {},
): Promise<
  GenerateApiResponse & {
    latency?: GenerateLatency;
    assetGen?: AssetGenStageResult;
    spriteSheet?: SpriteSheetStageResult;
  }
> {
  // TM-102 — opt-in multi-step pipeline (outline → scene → code).
  // Off by default; flipped on per-request via AI_MULTI_STEP=1 until
  // bench (TM-46 r7) shows uplift. ADR-PENDING-TM-102.
  //
  // TM-136 — removed the legacy `!opts.answers` co-guard. The original
  // intent was to keep clarify-answer rounds on the proven single-shot
  // path, but it had the unintended consequence of making asset-gen (which
  // ONLY ran inside the multi-step branch) unreachable for the exact
  // prompts that need it most: living-entity prompts ALWAYS go through
  // clarify, so by the time we have answers we'd never enter the branch
  // that calls runAssetGenStage. See `wiki/05-reports/2026-05-15-TM-135-quality-rca-research.md`.
  //
  // TM-139 — multi-step default ON for character/scene prompts. TM-135
  // RCA D4: AI_MULTI_STEP env was unset in prod, so multi-step (and the
  // ≥2-scene outline + scene-level reasoning depth it provides) never ran
  // for the living-entity prompts that benefit most. Now: if a living
  // entity is detected, auto-route to multi-step UNLESS the operator has
  // explicitly opted out via `AI_MULTI_STEP=0`. Generic motion-graphics
  // prompts retain the single-shot default (latency budget preserved).
  const envFlag = process.env.AI_MULTI_STEP;
  const livingEntityHit = detectLivingEntity(prompt, opts.answers);
  const autoMultiStep = livingEntityHit.matched && envFlag !== '0';
  if (envFlag === '1' || autoMultiStep) {
    const { generateAssetMultiStepAsApiResponse } = await import('./pipeline');
    return await generateAssetMultiStepAsApiResponse(prompt, model, {
      answers: opts.answers,
    });
  }

  const result = await generateAssetSingleShot(prompt, model, opts);
  return result;
}

/**
 * TM-136 — finalize a single-shot generate result by:
 *   1. Substituting the LLM's TM136_IMAGE_URL_PLACEHOLDER (or back-filling
 *      a missing imageUrl PARAMS field) with the real asset-gen URL.
 *   2. Re-extracting parameters so the customize UI sees the new field.
 *   3. Re-transpiling the modified TSX so jsCode stays in sync with code.
 *   4. Attaching the AssetGenStageResult on the return value for telemetry.
 *
 * If `assetGen` is null OR the result is a clarify response, the input
 * is returned unchanged (modulo the assetGen marker for telemetry).
 */
async function finalizeWithAssetGen<T extends GenerateApiResponse & { latency?: GenerateLatency }>(
  result: T,
  assetGen: AssetGenStageResult | null,
): Promise<T & { assetGen?: AssetGenStageResult }> {
  if (!assetGen) return result as T & { assetGen?: AssetGenStageResult };
  if (result.type !== 'generate') {
    // Clarify path — surface the asset-gen marker but don't touch the
    // questions payload.
    return { ...result, assetGen } as T & { assetGen?: AssetGenStageResult };
  }
  const original = result.asset.code;
  const injected = injectAssetImageUrl(original, assetGen.imageUrl);
  if (injected === original) {
    // Nothing to substitute (no placeholder, no back-fill). Still
    // surface the marker so the UI can display the asset.
    return { ...result, assetGen } as T & { assetGen?: AssetGenStageResult };
  }
  // Re-validate + re-transpile. Validation must still pass (we only
  // substituted a string literal). On any failure, fall back to the
  // original code rather than blocking the user.
  try {
    const validation = validateCode(injected);
    if (!validation.valid) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[TM-136] post-injection validation failed, keeping original code:',
          validation.errors.join(', '),
        );
      }
      return { ...result, assetGen } as T & { assetGen?: AssetGenStageResult };
    }
    const sanitized = sanitizeCode(injected);
    const jsCode = await transpileTSX(sanitized);
    const parameters = extractParameters(injected);
    return {
      ...result,
      asset: { ...result.asset, code: injected, jsCode, parameters },
      assetGen,
    } as T & { assetGen?: AssetGenStageResult };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-136] post-injection transpile failed, keeping original code:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return { ...result, assetGen } as T & { assetGen?: AssetGenStageResult };
  }
}

/**
 * TM-136 — single-shot path extracted so the asset-gen pre-stage and the
 * post-LLM URL injection share one code path with all the existing retry
 * branches (TM-51 placeholder retry, TM-52 force-generate, TM-67 transpile
 * retry, TM-105 dynamic clarify, etc.) without sprinkling injection logic
 * at every `return` site.
 */
/**
 * TM-142 — finalize a single-shot generate result for the sprite-sheet
 * path. Mirrors `finalizeWithAssetGen` but injects the 4-frame array
 * into PARAMS.spriteFrames instead of a single imageUrl string.
 */
async function finalizeWithSpriteSheet<T extends GenerateApiResponse & { latency?: GenerateLatency }>(
  result: T,
  spriteSheet: SpriteSheetStageResult | null,
): Promise<T & { spriteSheet?: SpriteSheetStageResult }> {
  if (!spriteSheet) return result as T & { spriteSheet?: SpriteSheetStageResult };
  if (result.type !== 'generate') {
    return { ...result, spriteSheet } as T & { spriteSheet?: SpriteSheetStageResult };
  }
  const original = result.asset.code;
  const injected = injectSpriteFrames(original, spriteSheet.frames);
  if (injected === original) {
    return { ...result, spriteSheet } as T & { spriteSheet?: SpriteSheetStageResult };
  }
  try {
    const validation = validateCode(injected);
    if (!validation.valid) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[TM-142] post-injection validation failed, keeping original code:',
          validation.errors.join(', '),
        );
      }
      return { ...result, spriteSheet } as T & { spriteSheet?: SpriteSheetStageResult };
    }
    const sanitized = sanitizeCode(injected);
    const jsCode = await transpileTSX(sanitized);
    const parameters = extractParameters(injected);
    return {
      ...result,
      asset: { ...result.asset, code: injected, jsCode, parameters },
      spriteSheet,
    } as T & { spriteSheet?: SpriteSheetStageResult };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-142] post-injection transpile failed, keeping original code:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return { ...result, spriteSheet } as T & { spriteSheet?: SpriteSheetStageResult };
  }
}

async function generateAssetSingleShot(
  prompt: string,
  model: string,
  opts: GenerateOptions,
): Promise<
  GenerateApiResponse & {
    latency?: GenerateLatency;
    assetGen?: AssetGenStageResult;
    spriteSheet?: SpriteSheetStageResult;
  }
> {
  // ----- TM-142 — sprite-sheet branch (opt-in, mutually exclusive with asset-gen) ---
  //
  // When AI_SPRITE_SHEET=1 (or opts.enableSpriteSheet), run the 4-frame
  // walk-cycle pipeline INSTEAD OF the single-PNG asset-gen stage. The
  // two are mutually exclusive — sharing PARAMS would confuse the LLM
  // (which subject does it animate?) and double the cost ($0.20).
  //
  // Same gating as TM-136: only fire when answers are present (round 2)
  // so we never burn 4× $0.04 on a clarify round. Failures swallow to
  // null and the LLM proceeds without the sprite addendum.
  if (
    isSpriteSheetEnabled(opts) &&
    !opts.disableAssetGen &&
    !!opts.answers &&
    Object.keys(opts.answers).length > 0
  ) {
    const hit = detectLivingEntity(prompt, opts.answers);
    if (hit.matched) {
      const stage = opts.__spriteSheetStage ?? runSpriteSheetStage;
      let spriteSheet: SpriteSheetStageResult | null = null;
      try {
        spriteSheet = await stage({ prompt, answers: opts.answers });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[generateAsset] TM-142 sprite-sheet stage failed, continuing without sprite:',
            err instanceof Error ? err.message : String(err),
          );
        }
        spriteSheet = null;
      }
      if (process.env.NODE_ENV !== 'production' && spriteSheet) {
        console.warn(
          '[generateAsset] TM-142 sprite-sheet ready:',
          {
            frames: spriteSheet.frames.length,
            cached: spriteSheet.cached,
            costUsd: spriteSheet.costUsd.toFixed(3),
            hash: spriteSheet.hash.slice(0, 12),
            token: spriteSheet.matchedToken,
          },
        );
      }
      const spriteAddendum = spriteSheet ? SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM : '';
      const rawResult = await generateAssetSingleShotCore(
        prompt,
        model,
        opts,
        spriteAddendum,
      );
      return await finalizeWithSpriteSheet(rawResult, spriteSheet);
    }
  }

  // ----- TM-136 — single-shot asset-gen (D1 fix) ---------------------
  //
  // Detect living-entity → kick off PNG generation BEFORE the LLM call so
  // we can append the addendum and inject the real URL into the response.
  // Cached hits return synchronously (~0ms) so this only adds wall-clock
  // on the very first generation per (prompt, answers, style) tuple.
  //
  // Failures swallow to null → the LLM proceeds with the un-addended
  // system prompt and the user sees the previous (vector-only) behaviour.
  // Never let asset-gen failure block a generation.
  // TM-136 — Gate on `opts.answers` presence: living-entity prompts always
  // go through clarify on round 1 (TM-95 narrow rule), so running asset-gen
  // before that clarify response is $0.04 of guaranteed waste. We only fire
  // asset-gen when answers are present (round 2 → guaranteed to hit
  // mode=generate) OR when the prompt is concrete enough to have skipped
  // clarify entirely (scoreConcreteness handled inside the LLM core path
  // can't be predicted here without re-prompting; we accept the false
  // negative for round-1 concrete living-entity prompts — the next edit
  // round will populate the cache anyway).
  const eligibleForAssetGen = !!opts.answers && Object.keys(opts.answers).length > 0;
  let assetGen: AssetGenStageResult | null = null;
  if (!opts.disableAssetGen && eligibleForAssetGen) {
    const hit = detectLivingEntity(prompt, opts.answers);
    if (hit.matched) {
      const stage = opts.__assetGenStage ?? runAssetGenStage;
      try {
        assetGen = await stage({ prompt, answers: opts.answers });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[generateAsset] TM-136 asset-gen stage failed, continuing without PNG:',
            err instanceof Error ? err.message : String(err),
          );
        }
        assetGen = null;
      }
      if (process.env.NODE_ENV !== 'production' && assetGen) {
        console.warn(
          '[generateAsset] TM-136 asset-gen ready:',
          { cached: assetGen.cached, hash: assetGen.hash.slice(0, 12), token: assetGen.matchedToken },
        );
      }
    }
  }

  // ----- TM-138 — vision-guided self-critique on the asset-gen PNG ----
  //
  // Judge the freshly-generated PNG against the user's prompt. If the
  // judge score < threshold (default 70), regenerate ONCE with a critique-
  // augmented prompt and keep whichever scored higher. NEVER blocks the
  // pipeline — judge/regen failures fall through to the original PNG.
  //
  // Skipped when:
  //   - asset-gen produced nothing (no living-entity hit),
  //   - the PNG was a cache hit (already judged on the prior generation),
  //   - AI_SELF_CRITIQUE=0 escape hatch is set.
  //
  // See `src/lib/ai/self-critique.ts` and TM-138 task spec.
  let selfCritique: SelfCritiqueResult | null = null;
  if (assetGen && !assetGen.cached && isSelfCritiqueEnabled()) {
    const initialDiskPath = path.join(
      process.cwd(),
      ASSET_GEN_DIR_REL,
      `${assetGen.hash}.png`,
    );
    // Test ergonomics: when callers stub `__assetGenStage` (TM-136 unit
    // tests) without also stubbing self-critique, the fake PNG isn't on
    // disk → judge would always fail. Default the self-critique to a noop
    // pass-through in that case so existing tests stay green and only
    // tests that explicitly opt into TM-138 behaviour exercise the loop.
    const defaultFn = opts.__assetGenStage
      ? async (input: { initial: AssetGenStageResult }): Promise<SelfCritiqueResult> => ({
          chosen: input.initial,
          scores: [],
          reasoning: [],
          retried: false,
          extraCostUsd: 0,
        })
      : judgeAndMaybeRegenerate;
    try {
      const fn = opts.__selfCritique ?? defaultFn;
      selfCritique = await fn({
        prompt,
        answers: opts.answers,
        initial: assetGen,
        initialDiskPath,
      });
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[generateAsset] TM-138 self-critique:',
          {
            scores: selfCritique.scores,
            retried: selfCritique.retried,
            extraCostUsd: selfCritique.extraCostUsd.toFixed(3),
            chosenHash: selfCritique.chosen.hash.slice(0, 12),
          },
        );
      }
      // Swap in the chosen (possibly retried) asset-gen result so URL
      // injection downstream points at the better PNG.
      assetGen = selfCritique.chosen;
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[generateAsset] TM-138 self-critique threw, keeping initial asset-gen:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  const assetGenAddendum = assetGen ? ASSET_GEN_SYSTEM_PROMPT_ADDENDUM : '';

  // Wrap the existing generation flow so EVERY return path passes
  // through finalizeWithAssetGen — keeps URL injection + parameter
  // re-extraction in one place instead of sprinkling at each return.
  const rawResult = await generateAssetSingleShotCore(
    prompt,
    model,
    opts,
    assetGenAddendum,
  );
  return await finalizeWithAssetGen(rawResult, assetGen);
}

/**
 * TM-136 — the LLM orchestration core, lifted verbatim from the original
 * `generateAsset`. Takes a pre-computed asset-gen system-prompt addendum
 * (empty string when no PNG is being generated for this prompt). All
 * existing retry / clarify / placeholder branches preserved unchanged —
 * the wrapper applies post-injection in one place.
 */
async function generateAssetSingleShotCore(
  prompt: string,
  model: string,
  opts: GenerateOptions,
  assetGenAddendum: string,
): Promise<GenerateApiResponse & { latency?: GenerateLatency }> {

  // TM-74 — Reference-template RAG. We resolve a reference once for this
  // prompt and append it to the system prompt for all attempts. Stable
  // across retries to preserve prompt-cache key (ADR-0003).
  // TM-46 r7 — RAG ablation: setting `RAG_DISABLE=1` skips reference
  // retrieval to measure RAG-ON vs RAG-OFF visual quality.
  const ragDisabled = process.env.RAG_DISABLE === '1';
  const rag = ragDisabled
    ? { addendum: '', reference: null, category: null, community: null }
    : retrieveReferenceForPrompt(prompt);
  const baseSystemPrompt =
    GENERATION_WITH_CLARIFY_SYSTEM_PROMPT + rag.addendum + assetGenAddendum;
  if (process.env.NODE_ENV !== 'production' && (rag.reference || rag.community)) {
    console.warn(
      '[generateAsset] TM-74/TM-141 RAG hit:',
      {
        category: rag.category,
        ref: rag.reference?.id ?? null,
        community: rag.community?.id ?? null,
      },
    );
  }
  if (process.env.NODE_ENV !== 'production' && ragDisabled) {
    console.warn('[generateAsset] TM-46 r7 RAG_DISABLE=1 — skipping retrieval');
  }

  // First attempt: standard system prompt + RAG reference (when present).
  const first = await generateOnce(
    prompt,
    model,
    opts,
    baseSystemPrompt,
  );

  // TM-52 — clarify over-trigger guard. If the LLM picked clarify but the
  // prompt is concrete enough (esp. Korean specific prompts that the model
  // misjudges as vague), retry once with a force-generate directive instead
  // of bouncing the user into a clarify dialog they didn't need.
  if (
    first.kind === 'response' &&
    first.value.type === 'clarify' &&
    !opts.answers // never override when caller already supplied answers
  ) {
    const report = scoreConcreteness(prompt);
    if (report.isConcrete) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[generateAsset] clarify over-trigger detected; forcing generate.',
          { score: report.score, hits: report.hits, isKorean: report.isKorean },
        );
      }
      const forced = await generateOnce(
        prompt,
        model,
        opts,
        baseSystemPrompt + FORCE_GENERATE_REINFORCEMENT,
      );
      if (forced.kind === 'response') {
        // TM-68 — the LLM may obey on flow-control yet still emit clarify.
        // When the prompt carries an explicit entity count, that's
        // unacceptable: do one final hardened retry quoting the count back.
        if (
          forced.value.type === 'clarify' &&
          report.forceSkipClarify
        ) {
          // TM-95: pick the reinforcement variant. If we have an explicit
          // entity count, quote it back (TM-68 path). Otherwise, this is a
          // data-viz subject+data prompt without a count — use the TM-95
          // dataviz reinforcement with tasteful defaults instead.
          const useEntityCount = report.entityCount > 0;
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `[generateAsset] hardened retry (${useEntityCount ? 'TM-68 entity-count' : 'TM-95 dataviz'}): forced retry still returned clarify`,
              { entityCount: report.entityCount, hits: report.hits },
            );
          }
          const extraReinforcement = useEntityCount
            ? buildEntityCountReinforcement(report.entityCount)
            : FORCE_GENERATE_DATAVIZ_REINFORCEMENT;
          const hardened = await generateOnce(
            prompt,
            model,
            opts,
            baseSystemPrompt +
              FORCE_GENERATE_REINFORCEMENT +
              extraReinforcement,
          );
          if (hardened.kind === 'response') {
            // Surface whatever this is — generate or (last-resort) clarify.
            return hardened.value;
          }
          if (hardened.kind === 'transpile_error') {
            throw new Error(
              `AI entity-count retry produced TSX that failed to transpile (${hardened.errorMessage}). ` +
                'Please rephrase your prompt and try again.',
            );
          }
          return generateAssetPlaceholderRetry(prompt, model, opts, hardened, baseSystemPrompt);
        }
        return forced.value;
      }
      // TM-67: forced retry transpile failure — surface error rather than
      // falling through to placeholder retry (type narrowing requirement).
      if (forced.kind === 'transpile_error') {
        throw new Error(
          `AI forced-generate retry produced TSX that failed to transpile (${forced.errorMessage}). ` +
            'Please rephrase your prompt and try again.',
        );
      }
      // Forced retry returned a placeholder — fall through to placeholder
      // handling below using `forced` as the new "first" attempt.
      return generateAssetPlaceholderRetry(prompt, model, opts, forced, baseSystemPrompt);
    }
  }

  if (first.kind === 'response') {
    // TM-105 — dynamic clarify questions. If the primary call elected to
    // clarify AND we did not over-trigger (handled above), regenerate the
    // questions via a dedicated, prompt-tailored second call. Falls back to
    // the original questions on any failure so we never block the user.
    if (first.value.type === 'clarify' && !opts.answers) {
      try {
        const tailored = await generateClarifyQuestions(prompt, { model });
        return {
          ...first.value,
          questions: tailored.questions,
        };
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[generateAsset] TM-105 dynamic clarify failed, using primary questions:',
            err instanceof Error ? err.message : String(err),
          );
        }
        // fall through with original questions
      }
    }
    return first.value;
  }

  // TM-67: transpile failure — retry once with a syntax-correctness reinforcement.
  if (first.kind === 'transpile_error') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[generateAsset] transpile failure, retrying once:',
        first.errorMessage,
      );
    }
    const transpileReinforced =
      baseSystemPrompt +
      buildTranspileRetryReinforcement(first.errorMessage);
    const second = await generateOnce(prompt, model, opts, transpileReinforced);
    if (second.kind === 'response') return second.value;
    if (second.kind === 'transpile_error') {
      throw new Error(
        `AI produced TSX that failed to transpile twice (last error: ${second.errorMessage}). ` +
          'Please rephrase your prompt or simplify the request and try again.',
      );
    }
    // Second attempt was a placeholder — surface as the standard placeholder error.
    throw new Error(
      `AI returned a placeholder/empty component on retry after transpile failure (${second.reasons.join('; ')}). ` +
        'Please rephrase your prompt with more detail and try again.',
    );
  }

  // TM-51: placeholder detected — retry once with reinforced system prompt.
  return generateAssetPlaceholderRetry(prompt, model, opts, first, baseSystemPrompt);
}

/**
 * TM-51 / TM-100 placeholder retry path — extracted so the TM-52 forced-generate
 * path can reuse it when its own forced retry also returns a placeholder.
 *
 * TM-74: callers pass the RAG-augmented base system prompt so the retry
 * keeps the reference template in context.
 *
 * TM-100: extended from one retry to two. Strategy:
 *   - Retry #1: standard reinforcement (GENERATION_NON_EMPTY_REINFORCEMENT).
 *   - Retry #2: forced-RAG reference (default counter exemplar if no
 *     category was inferred) + STRICT reinforcement.
 *   - Three strikes → return a working FALLBACK ASSET (built from a known
 *     template) plus a `warning` field, instead of throwing. Rationale:
 *     a hard error blocks the user; a fallback at least lets them edit
 *     something concrete.
 */
async function generateAssetPlaceholderRetry(
  prompt: string,
  model: string,
  opts: GenerateOptions,
  first: { kind: 'placeholder'; reasons: string[]; rawCode: string },
  baseSystemPrompt: string = GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
): Promise<GenerateApiResponse & { latency?: GenerateLatency }> {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[generateAsset] placeholder detected, retry #1/2:',
      first.reasons.join('; '),
    );
  }

  // ----- Retry #1: standard reinforcement -----
  const reinforced = baseSystemPrompt + GENERATION_NON_EMPTY_REINFORCEMENT;
  const second = await generateOnce(prompt, model, opts, reinforced);
  if (second.kind === 'response') return second.value;
  if (second.kind === 'transpile_error') {
    throw new Error(
      `AI placeholder retry produced TSX that failed to transpile (${second.errorMessage}). ` +
        'Please rephrase your prompt and try again.',
    );
  }

  // Two strikes — escalate to forced-RAG + strict reinforcement (Retry #2).
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[generateAsset] placeholder detected, retry #2/2 with forced RAG:',
      second.reasons.join('; '),
    );
  }
  const forcedRag = retrieveForcedReferenceForPrompt(prompt);
  const strictSystem =
    GENERATION_WITH_CLARIFY_SYSTEM_PROMPT +
    forcedRag.addendum +
    GENERATION_NON_EMPTY_REINFORCEMENT_STRICT;
  const third = await generateOnce(prompt, model, opts, strictSystem);
  if (third.kind === 'response') return third.value;
  if (third.kind === 'transpile_error') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[generateAsset] strict retry transpile failure, falling back:',
        third.errorMessage,
      );
    }
    return await buildFallbackAsset(prompt, [
      `transpile error: ${third.errorMessage}`,
      ...second.reasons,
      ...first.reasons,
    ]);
  }

  // Three strikes — return a fallback so the user is unblocked.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[generateAsset] placeholder x3, returning fallback asset:',
      third.reasons.join('; '),
    );
  }
  return await buildFallbackAsset(prompt, [
    ...third.reasons,
    ...second.reasons,
    ...first.reasons,
  ]);
}

/**
 * TM-100: Build a known-good fallback asset from a built-in template so the
 * user is never fully blocked when the LLM repeatedly returns placeholders.
 * The returned response carries a `warning` field that the UI surfaces as
 * a non-fatal toast: "We used a default template — please rephrase for a
 * tailored result."
 */
const FALLBACK_TEMPLATE_FILENAME = 'CounterAnimation.tsx';
// TM-120: improved UX. The previous wording was technically correct but
// unhelpful — users got blocked without knowing what "rephrase" means.
// The new copy is action-oriented with three concrete success patterns the
// user can adapt.
const FALLBACK_WARNING =
  "We couldn't quite generate from that prompt and substituted a default template. " +
  'Try adding a concrete subject + one of {palette, duration, data, style}. ' +
  'Examples that work well:\n' +
  '  • "Bar chart top 5 products by revenue, purple gradient, 4s"\n' +
  '  • "픽셀아트 곰돌이가 걷는 애니메이션, 파스텔 톤"\n' +
  '  • "Fade in fade out logo intro, neon cyan, 2 seconds"';

async function buildFallbackAsset(
  prompt: string,
  observedReasons: string[],
): Promise<GenerateApiResponse & { latency?: GenerateLatency }> {
  void prompt;
  const source = readTemplateSource(FALLBACK_TEMPLATE_FILENAME);
  if (!source) {
    // If even the fallback template is unavailable (test env / fs failure),
    // surface the original error so callers still get a signal.
    throw new Error(
      `AI returned a placeholder/empty component three times (${observedReasons.join('; ')}). ` +
        'Please rephrase your prompt with more detail and try again.',
    );
  }
  // Strip imports because runtime injects Remotion / React as globals.
  const code = source.replace(/^\s*import[^\n]*\n/gm, '').trim();
  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(
      `Fallback template failed sandbox validation: ${validation.errors.join(', ')}`,
    );
  }
  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);
  const parameters = extractParameters(code);
  const asset: GeneratedAsset = {
    id: crypto.randomUUID(),
    title: 'Default Template (please refine your prompt)',
    code,
    jsCode,
    parameters,
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  };
  return { type: 'generate', asset, warning: FALLBACK_WARNING };
}
