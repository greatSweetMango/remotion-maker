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
 * Extract first balanced JSON object from raw LLM text.
 * Tolerates leading prose / code fences. Returns null on failure.
 */
function extractJson(text: string): unknown | null {
  // Strip code fences first
  const fenceStripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const start = fenceStripped.indexOf('{');
  if (start < 0) return null;
  // Walk to find matching brace (naive but tolerates strings without escapes covering braces)
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < fenceStripped.length; i++) {
    const ch = fenceStripped[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = fenceStripped.slice(start, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
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
