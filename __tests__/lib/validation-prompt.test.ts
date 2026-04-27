/**
 * Unit tests for the shared prompt validator (TM-58).
 */
import { validatePrompt, stripZeroWidth, MAX_PROMPT_LENGTH } from '@/lib/validation/prompt';

// Zero-width char fixtures (TM-57). Defined as escapes so this test source
// stays grep-friendly.
const ZWSP = '\u200B'; // ZERO WIDTH SPACE
const ZWNJ = '\u200C'; // ZERO WIDTH NON-JOINER
const ZWJ = '\u200D'; // ZERO WIDTH JOINER
const WJ = '\u2060'; // WORD JOINER
const BOM = '\uFEFF'; // ZERO WIDTH NO-BREAK SPACE / BOM

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

  // ---------------------------------------------------------------------
  // TM-57 — zero-width characters must not slip through emptiness check.
  // Repro: TM-45 fuzz harness, case A4.
  // ---------------------------------------------------------------------
  describe('zero-width handling (TM-57)', () => {
    it('rejects a prompt containing only ZWSP', () => {
      expect(validatePrompt(ZWSP)?.code).toBe('PROMPT_REQUIRED');
    });

    it('rejects a prompt containing only ZWNJ', () => {
      expect(validatePrompt(ZWNJ)?.code).toBe('PROMPT_REQUIRED');
    });

    it('rejects a prompt containing only ZWJ', () => {
      expect(validatePrompt(ZWJ)?.code).toBe('PROMPT_REQUIRED');
    });

    it('rejects a prompt containing only WORD JOINER (U+2060)', () => {
      expect(validatePrompt(WJ)?.code).toBe('PROMPT_REQUIRED');
    });

    it('rejects a prompt containing only BOM (U+FEFF)', () => {
      expect(validatePrompt(BOM)?.code).toBe('PROMPT_REQUIRED');
    });

    it('rejects a mix of zero-width chars + ASCII whitespace', () => {
      const input = `  ${ZWSP}\t${ZWJ}\n${BOM} ${WJ}`;
      expect(validatePrompt(input)?.code).toBe('PROMPT_REQUIRED');
    });

    it('replicates TM-45 fuzz case A4 exactly', () => {
      // The original case: every supported zero-width char concatenated.
      const a4 = ZWSP + ZWNJ + ZWJ + BOM;
      expect(validatePrompt(a4)?.code).toBe('PROMPT_REQUIRED');
    });

    it('still accepts a prompt with embedded zero-width chars amongst real text', () => {
      // Visible content remains, so this is a legit (if weird) prompt — accept.
      expect(validatePrompt(`hello${ZWSP}world`)).toBeNull();
    });

    it('counts zero-width chars toward the length cap (cannot bypass cap)', () => {
      // 1999 visible + 2 zero-width = 2001 length → over cap.
      const padded = 'a'.repeat(MAX_PROMPT_LENGTH - 1) + ZWSP + ZWJ;
      const err = validatePrompt(padded);
      expect(err?.code).toBe('PROMPT_TOO_LONG');
      expect(err?.meta?.length).toBe(MAX_PROMPT_LENGTH + 1);
    });

    describe('stripZeroWidth', () => {
      it('removes all five supported zero-width characters', () => {
        const input = `a${ZWSP}b${ZWNJ}c${ZWJ}d${WJ}e${BOM}f`;
        expect(stripZeroWidth(input)).toBe('abcdef');
      });

      it('is a no-op for a clean string', () => {
        expect(stripZeroWidth('hello world')).toBe('hello world');
      });

      it('returns empty string for an all-zero-width input', () => {
        expect(stripZeroWidth(ZWSP + ZWJ + BOM + WJ + ZWNJ)).toBe('');
      });
    });
  });
});
