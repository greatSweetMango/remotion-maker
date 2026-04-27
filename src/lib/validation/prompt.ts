/**
 * Server-side prompt validation.
 *
 * TM-58 — caps user-facing prompt length on /api/generate and /api/edit
 * to prevent cost amplification (LLM input token billing scales linearly,
 * and oversized prompts can also exhaust the context window for the
 * generated code that follows). Discovered via TM-45 fuzz harness:
 * 10,500-char prompts were accepted as 200 OK.
 *
 * Cap rationale: 2000 chars is comfortably above realistic user inputs —
 * a complex multi-scene Korean prompt fits well under it (Korean averages
 * ~1 char per visible glyph in JS string length terms with surrogate pairs
 * counted, and a typical detailed scene description is 200-600 chars).
 *
 * Counts JS string `.length` (UTF-16 code units). Emoji + surrogate pairs
 * thus count as 2; we accept this slight over-counting because it tightens
 * the cost ceiling rather than loosening it. We do NOT trim before measuring
 * so trailing whitespace abuse is also bounded.
 */

export const MAX_PROMPT_LENGTH = 2000;

export type PromptValidationError = {
  code: 'PROMPT_TOO_LONG' | 'PROMPT_REQUIRED';
  message: string;
  /** HTTP status the API route should respond with. */
  status: 400;
  meta?: { length: number; max: number };
};

/**
 * Validate a user-supplied prompt.
 * Returns null on success, or a structured error on failure.
 */
export function validatePrompt(prompt: unknown): PromptValidationError | null;
export function validatePrompt(prompt: string | undefined): PromptValidationError | null;
export function validatePrompt(prompt: unknown): PromptValidationError | null {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return {
      code: 'PROMPT_REQUIRED',
      message: 'Prompt required',
      status: 400,
    };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      code: 'PROMPT_TOO_LONG',
      message: `프롬프트가 너무 깁니다. ${MAX_PROMPT_LENGTH}자 이하로 입력해주세요. (현재 ${prompt.length}자)`,
      status: 400,
      meta: { length: prompt.length, max: MAX_PROMPT_LENGTH },
    };
  }

  return null;
}
