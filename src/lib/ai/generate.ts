import { chatComplete, chatCompleteStream, getModels } from './client';
import {
  GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
  GENERATION_NON_EMPTY_REINFORCEMENT,
  buildTranspileRetryReinforcement,
} from './prompts';
import {
  scoreConcreteness,
  FORCE_GENERATE_REINFORCEMENT,
  buildEntityCountReinforcement,
} from './clarify-gate';
import { extractParameters } from './extract-params';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
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
 * Extract first balanced JSON object from raw LLM text.
 * Tolerates leading prose / code fences and backtick-quoted string values.
 * Returns null on failure.
 */
function extractJson(text: string): unknown | null {
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
  try { return JSON.parse(slice); } catch {}
  // Fallback: repair backtick-quoted string values to JSON strings.
  try { return JSON.parse(repairBacktickStrings(slice)); } catch {}
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

export async function generateAsset(
  prompt: string,
  model: string = getModels().free,
  opts: GenerateOptions = {},
): Promise<GenerateApiResponse & { latency?: GenerateLatency }> {
  // First attempt: standard system prompt.
  const first = await generateOnce(
    prompt,
    model,
    opts,
    GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
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
        GENERATION_WITH_CLARIFY_SYSTEM_PROMPT + FORCE_GENERATE_REINFORCEMENT,
      );
      if (forced.kind === 'response') {
        // TM-68 — the LLM may obey on flow-control yet still emit clarify.
        // When the prompt carries an explicit entity count, that's
        // unacceptable: do one final hardened retry quoting the count back.
        if (
          forced.value.type === 'clarify' &&
          report.forceSkipClarify &&
          report.entityCount > 0
        ) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              '[generateAsset] entity-count override (TM-68): forced retry still returned clarify',
              { entityCount: report.entityCount, hits: report.hits },
            );
          }
          const hardened = await generateOnce(
            prompt,
            model,
            opts,
            GENERATION_WITH_CLARIFY_SYSTEM_PROMPT +
              FORCE_GENERATE_REINFORCEMENT +
              buildEntityCountReinforcement(report.entityCount),
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
          return generateAssetPlaceholderRetry(prompt, model, opts, hardened);
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
      return generateAssetPlaceholderRetry(prompt, model, opts, forced);
    }
  }

  if (first.kind === 'response') return first.value;

  // TM-67: transpile failure — retry once with a syntax-correctness reinforcement.
  if (first.kind === 'transpile_error') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[generateAsset] transpile failure, retrying once:',
        first.errorMessage,
      );
    }
    const transpileReinforced =
      GENERATION_WITH_CLARIFY_SYSTEM_PROMPT +
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
  return generateAssetPlaceholderRetry(prompt, model, opts, first);
}

/**
 * TM-51 placeholder retry path — extracted so the TM-52 forced-generate path
 * can reuse it when its own forced retry also returns a placeholder.
 */
async function generateAssetPlaceholderRetry(
  prompt: string,
  model: string,
  opts: GenerateOptions,
  first: { kind: 'placeholder'; reasons: string[]; rawCode: string },
): Promise<GenerateApiResponse & { latency?: GenerateLatency }> {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[generateAsset] placeholder detected, retrying once:',
      first.reasons.join('; '),
    );
  }
  const reinforced =
    GENERATION_WITH_CLARIFY_SYSTEM_PROMPT + GENERATION_NON_EMPTY_REINFORCEMENT;
  const second = await generateOnce(prompt, model, opts, reinforced);
  if (second.kind === 'response') return second.value;
  if (second.kind === 'transpile_error') {
    throw new Error(
      `AI placeholder retry produced TSX that failed to transpile (${second.errorMessage}). ` +
        'Please rephrase your prompt and try again.',
    );
  }

  // Two strikes: surface a user-facing error rather than render a blank screen.
  throw new Error(
    `AI returned a placeholder/empty component twice (${second.reasons.join('; ')}). ` +
      'Please rephrase your prompt with more detail and try again.',
  );
}
