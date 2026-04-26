import { chatComplete, getModels } from './client';
import { GENERATION_WITH_CLARIFY_SYSTEM_PROMPT } from './prompts';
import { extractParameters } from './extract-params';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import type { GeneratedAsset, GenerateApiResponse, ClarifyAnswers, ClarifyQuestion } from '@/types';

export interface GenerateOptions {
  /** When provided, prior clarify answers are appended so LLM forces mode=generate. */
  answers?: ClarifyAnswers;
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

export async function generateAsset(
  prompt: string,
  model: string = getModels().free,
  opts: GenerateOptions = {},
): Promise<GenerateApiResponse> {
  const userContent = buildUserMessage(prompt, opts.answers);

  const text = await chatComplete({
    model,
    system: GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

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
    return { type: 'clarify', questions: questions as ClarifyQuestion[] };
  }

  // mode === 'generate' (or omitted — default to generate path for backward compat)
  const code = obj.code as string | undefined;
  if (!code) throw new Error('AI generate response missing code');

  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(`Generated code failed security check: ${validation.errors.join(', ')}`);
  }

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);
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

  return { type: 'generate', asset };
}
