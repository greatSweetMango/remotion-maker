/**
 * TM-59 — refusal classifier unit tests.
 *
 * Coverage: D1-D7 prompt categories from TM-45 fuzz, plus jailbreak /
 * system-override variants and Korean refusal blurbs.
 */
import {
  classifyRefusal,
  refusalMessage,
  refusalCode,
  AiRefusalError,
} from '@/lib/ai/refusal';

describe('classifyRefusal', () => {
  describe('safety category', () => {
    // D1-D7 fuzz cases trigger LLM safety refusals like these.
    const safetyBlurbs: Array<{ name: string; text: string }> = [
      {
        name: 'D1 <script> injection',
        text: "I'm sorry, but I can't help with embedding script tags or executing arbitrary JavaScript in the rendered output as that would be unsafe content.",
      },
      {
        name: 'D2 fetch+cookie exfiltration',
        text: 'I cannot generate code that exfiltrates user cookies — this violates content policy and is illegal activity.',
      },
      {
        name: 'D3 eval()',
        text: 'Sorry, I cannot provide code that uses eval() to execute arbitrary strings.',
      },
      {
        name: 'D4 new Function()',
        text: "I'm not able to help with code that dynamically constructs functions from strings.",
      },
      {
        name: 'D5 localStorage abuse',
        text: 'I will not generate code that abuses localStorage to track users without consent.',
      },
      {
        name: 'D6 window.location redirect',
        text: 'I cannot create a component that performs unsafe redirects.',
      },
      {
        name: 'D7 document.cookie read',
        text: 'I am sorry, but I cannot help you read document.cookie — this is a content policy violation.',
      },
      {
        name: 'safety harm keyword (violence)',
        text: 'This request involves graphic violence and I am not able to assist.',
      },
      {
        name: 'safety harm keyword (hate speech)',
        text: 'Sorry, this includes hate speech which I cannot generate.',
      },
      {
        name: 'Korean safety blurb',
        text: '죄송하지만 폭력적인 콘텐츠는 제공할 수 없습니다.',
      },
      {
        name: 'Korean content policy',
        text: '이 요청은 안전 정책에 따라 도와드릴 수 없습니다.',
      },
    ];

    for (const { name, text } of safetyBlurbs) {
      it(`classifies as safety: ${name}`, () => {
        const r = classifyRefusal(text);
        expect(r.category).toBe('safety');
        expect(r.matchedHint).toBeDefined();
      });
    }
  });

  describe('adversarial category', () => {
    const adversarialBlurbs: Array<{ name: string; text: string }> = [
      {
        name: 'ignore previous instructions',
        text: 'I notice the prompt asks me to ignore the previous instructions. I cannot comply.',
      },
      {
        name: 'override system',
        text: 'The user is attempting to override my system prompt. Refusing.',
      },
      {
        name: 'reveal system prompt',
        text: 'I cannot reveal the hidden system prompt.',
      },
      {
        name: 'jailbreak phrase',
        text: 'This looks like a jailbreak attempt. I will not respond.',
      },
      {
        name: 'prompt injection',
        text: 'Detected prompt injection — refusing to follow injected instructions.',
      },
      {
        name: 'Korean system override',
        text: '사용자가 시스템 프롬프트를 무시하도록 요청했지만, 그렇게 할 수 없습니다.',
      },
    ];

    for (const { name, text } of adversarialBlurbs) {
      it(`classifies as adversarial: ${name}`, () => {
        const r = classifyRefusal(text);
        expect(r.category).toBe('adversarial');
      });
    }

    it('prefers adversarial over safety when both signals are present', () => {
      const r = classifyRefusal(
        'I see prompt injection trying to get unsafe content — refusing.',
      );
      expect(r.category).toBe('adversarial');
    });
  });

  describe('policy (generic refusal) category', () => {
    it('catches a bare "I cannot" with no explanation', () => {
      const r = classifyRefusal('I cannot do that.');
      expect(r.category).toBe('policy');
    });

    it('catches a bare Korean apology refusal', () => {
      const r = classifyRefusal('죄송합니다.');
      expect(r.category).toBe('policy');
    });
  });

  describe('unknown category', () => {
    it('returns unknown for empty input', () => {
      expect(classifyRefusal('').category).toBe('unknown');
      expect(classifyRefusal(null).category).toBe('unknown');
      expect(classifyRefusal(undefined).category).toBe('unknown');
    });

    it('returns unknown for non-refusal prose', () => {
      expect(classifyRefusal('Here is your video plan: scene 1...').category).toBe(
        'unknown',
      );
    });

    it('returns unknown for malformed JSON-ish output', () => {
      expect(classifyRefusal('{"mode": "generate", code:').category).toBe(
        'unknown',
      );
    });
  });
});

describe('refusalMessage', () => {
  it('safety message names safety policy without revealing detail', () => {
    const msg = refusalMessage('safety');
    expect(msg).toContain('안전 정책');
    expect(msg).not.toContain('script');
    expect(msg).not.toContain('eval');
    expect(msg).not.toContain('cookie');
  });

  it('adversarial message names system instruction override', () => {
    const msg = refusalMessage('adversarial');
    expect(msg).toContain('시스템 지시');
  });

  it('policy message stays generic', () => {
    const msg = refusalMessage('policy');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain('안전 정책');
    expect(msg).not.toContain('시스템 지시');
  });

  it('unknown returns a parser-failure flavored fallback', () => {
    const msg = refusalMessage('unknown');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('refusalCode', () => {
  it('maps each category to a stable code', () => {
    expect(refusalCode('safety')).toBe('AI_REFUSAL_SAFETY');
    expect(refusalCode('adversarial')).toBe('AI_REFUSAL_ADVERSARIAL');
    expect(refusalCode('policy')).toBe('AI_REFUSAL_POLICY');
    expect(refusalCode('unknown')).toBe('AI_PARSE_FAILED');
  });
});

describe('AiRefusalError', () => {
  it('carries category, code, and Korean user-facing message', () => {
    const err = new AiRefusalError({ category: 'safety', matchedHint: 'en:harm-keyword' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AiRefusalError');
    expect(err.category).toBe('safety');
    expect(err.code).toBe('AI_REFUSAL_SAFETY');
    expect(err.matchedHint).toBe('en:harm-keyword');
    expect(err.message).toContain('안전 정책');
  });

  it('does not leak the matched hint into the user-facing message', () => {
    const err = new AiRefusalError({
      category: 'adversarial',
      matchedHint: 'en:ignore-previous',
    });
    expect(err.message).not.toContain('en:ignore-previous');
    expect(err.message).not.toContain('ignore-previous');
  });
});
