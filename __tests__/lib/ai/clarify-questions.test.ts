/**
 * TM-105 — dynamic clarify-questions generator unit tests.
 */
jest.mock('@/lib/ai/client', () => ({
  chatComplete: jest.fn(),
  getModels: () => ({ free: 'haiku', pro: 'sonnet' }),
}));

import { chatComplete } from '@/lib/ai/client';
import {
  generateClarifyQuestions,
  normalizeClarifyResponse,
  parseClarifyJson,
  ClarifyQuestionsValidationError,
} from '@/lib/ai/clarify-questions';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

const VALID_PAYLOAD = {
  questions: [
    {
      id: 'style',
      question: '전체적인 스타일은?',
      choices: [
        { id: 'casual', label: '캐주얼' },
        { id: 'luxury', label: '럭셔리' },
        { id: 'minimal', label: '미니멀' },
      ],
    },
    {
      id: 'pacing',
      question: '전환 속도는?',
      choices: [
        { id: 'slow', label: '느리게' },
        { id: 'fast', label: '빠르게' },
      ],
    },
    {
      id: 'text_overlay',
      question: '텍스트 오버레이?',
      choices: [
        { id: 'none', label: '없음' },
        { id: 'caption', label: '캡션' },
      ],
    },
  ],
};

describe('parseClarifyJson', () => {
  it('parses clean JSON object', () => {
    expect(parseClarifyJson(JSON.stringify(VALID_PAYLOAD))).toEqual(VALID_PAYLOAD);
  });

  it('strips ```json fences', () => {
    const wrapped = '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```';
    expect(parseClarifyJson(wrapped)).toEqual(VALID_PAYLOAD);
  });

  it('extracts JSON when prose precedes', () => {
    const text = "Here you go:\n" + JSON.stringify(VALID_PAYLOAD);
    expect(parseClarifyJson(text)).toEqual(VALID_PAYLOAD);
  });

  it('returns null on totally invalid output', () => {
    expect(parseClarifyJson('not a json at all')).toBeNull();
    expect(parseClarifyJson('')).toBeNull();
  });
});

describe('normalizeClarifyResponse', () => {
  it('passes through valid payload (capped at 5)', () => {
    const res = normalizeClarifyResponse(VALID_PAYLOAD);
    expect(res.questions).toHaveLength(3);
    expect(res.questions[0].id).toBe('style');
  });

  it('caps at 5 questions', () => {
    const big = {
      questions: Array.from({ length: 8 }, (_, i) => ({
        id: `q${i}`,
        question: `question ${i}?`,
        choices: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      })),
    };
    expect(normalizeClarifyResponse(big).questions).toHaveLength(5);
  });

  it('drops malformed questions but keeps valid ones', () => {
    const mixed = {
      questions: [
        ...VALID_PAYLOAD.questions,
        { id: 'broken', question: '', choices: [{ id: 'a', label: 'A' }] }, // empty question
        { id: 'broken2', question: 'Q', choices: [] }, // no choices
        { id: 'broken3', question: 'Q', choices: [{ id: 'a', label: 'A' }] }, // <2 choices
      ],
    };
    expect(normalizeClarifyResponse(mixed).questions).toHaveLength(3);
  });

  it('throws when fewer than 3 valid questions', () => {
    const tooFew = {
      questions: [VALID_PAYLOAD.questions[0]],
    };
    expect(() => normalizeClarifyResponse(tooFew)).toThrow(
      ClarifyQuestionsValidationError,
    );
  });

  it('dedupes question ids', () => {
    const dup = {
      questions: [
        VALID_PAYLOAD.questions[0],
        { ...VALID_PAYLOAD.questions[0], question: 'second!' },
        VALID_PAYLOAD.questions[1],
      ],
    };
    const out = normalizeClarifyResponse(dup);
    const ids = out.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dedupes choice ids within a question', () => {
    const choiceDup = {
      questions: [
        {
          id: 'q1',
          question: 'Q',
          choices: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'A2' },
            { id: 'b', label: 'B' },
          ],
        },
        VALID_PAYLOAD.questions[1],
        VALID_PAYLOAD.questions[2],
      ],
    };
    const out = normalizeClarifyResponse(choiceDup);
    expect(out.questions[0].choices).toHaveLength(2);
  });

  it('throws on non-object input', () => {
    expect(() => normalizeClarifyResponse(null)).toThrow();
    expect(() => normalizeClarifyResponse('string')).toThrow();
  });

  it('accepts {questions} or bare array', () => {
    const bare = VALID_PAYLOAD.questions;
    expect(normalizeClarifyResponse(bare).questions).toHaveLength(3);
  });
});

describe('generateClarifyQuestions', () => {
  beforeEach(() => mockedChat.mockReset());

  it('returns normalized response on happy path', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify(VALID_PAYLOAD));
    const res = await generateClarifyQuestions('이미지 슬라이드쇼');
    expect(res.questions).toHaveLength(3);
    expect(mockedChat).toHaveBeenCalledTimes(1);
    const callArgs = mockedChat.mock.calls[0][0];
    expect(callArgs.system).toMatch(/clarifying questions/i);
    expect(callArgs.messages[0].content).toContain('이미지 슬라이드쇼');
  });

  it('uses provided model override', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify(VALID_PAYLOAD));
    await generateClarifyQuestions('test', { model: 'custom-model' });
    expect(mockedChat.mock.calls[0][0].model).toBe('custom-model');
  });

  it('throws ClarifyQuestionsValidationError on unparseable output', async () => {
    mockedChat.mockResolvedValueOnce('total garbage with no json');
    await expect(generateClarifyQuestions('x')).rejects.toBeInstanceOf(
      ClarifyQuestionsValidationError,
    );
  });

  it('throws when LLM returns < 3 valid questions', async () => {
    mockedChat.mockResolvedValueOnce(
      JSON.stringify({ questions: [VALID_PAYLOAD.questions[0]] }),
    );
    await expect(generateClarifyQuestions('x')).rejects.toBeInstanceOf(
      ClarifyQuestionsValidationError,
    );
  });

  it('handles fenced JSON output', async () => {
    mockedChat.mockResolvedValueOnce(
      '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```',
    );
    const res = await generateClarifyQuestions('x');
    expect(res.questions).toHaveLength(3);
  });
});
