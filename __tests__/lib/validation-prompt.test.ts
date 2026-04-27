/**
 * Unit tests for the shared prompt validator (TM-58).
 */
import { validatePrompt, MAX_PROMPT_LENGTH } from '@/lib/validation/prompt';

describe('validatePrompt', () => {
  it('accepts a normal prompt', () => {
    expect(validatePrompt('make a glowing logo')).toBeNull();
  });

  it('accepts a prompt at exactly the cap', () => {
    expect(validatePrompt('a'.repeat(MAX_PROMPT_LENGTH))).toBeNull();
  });

  it('rejects empty / whitespace prompts as PROMPT_REQUIRED', () => {
    expect(validatePrompt(undefined)?.code).toBe('PROMPT_REQUIRED');
    expect(validatePrompt('')?.code).toBe('PROMPT_REQUIRED');
    expect(validatePrompt('   \n\t')?.code).toBe('PROMPT_REQUIRED');
    expect(validatePrompt(123 as unknown)?.code).toBe('PROMPT_REQUIRED');
  });

  it('rejects oversized prompts as PROMPT_TOO_LONG with meta', () => {
    const tooLong = 'x'.repeat(MAX_PROMPT_LENGTH + 1);
    const err = validatePrompt(tooLong);
    expect(err).not.toBeNull();
    expect(err?.code).toBe('PROMPT_TOO_LONG');
    expect(err?.status).toBe(400);
    expect(err?.meta?.length).toBe(MAX_PROMPT_LENGTH + 1);
    expect(err?.meta?.max).toBe(MAX_PROMPT_LENGTH);
  });

  it('rejects the 10500-char prompt that TM-45 fuzz reported as accepted', () => {
    const fuzzInput = 'a'.repeat(10500);
    expect(validatePrompt(fuzzInput)?.code).toBe('PROMPT_TOO_LONG');
  });

  it('cap is set to 2000 (regression guard)', () => {
    expect(MAX_PROMPT_LENGTH).toBe(2000);
  });
});
