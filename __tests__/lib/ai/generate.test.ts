/**
 * Unit tests for generateAsset clarify/generate dispatch.
 * We mock chatComplete to control LLM output.
 */
jest.mock('@/lib/ai/client', () => ({
  chatComplete: jest.fn(),
  getModels: () => ({ free: 'haiku', pro: 'sonnet' }),
}));

jest.mock('@/lib/remotion/transpiler', () => ({
  transpileTSX: jest.fn(async (s: string) => `/*js*/${s}`),
}));

jest.mock('@/lib/remotion/sandbox', () => ({
  validateCode: jest.fn(() => ({ valid: true, errors: [] })),
  sanitizeCode: jest.fn((s: string) => s),
}));

jest.mock('@/lib/ai/extract-params', () => ({
  extractParameters: jest.fn(() => []),
}));

import { chatComplete } from '@/lib/ai/client';
import { generateAsset } from '@/lib/ai/generate';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

const stubGenerateJson = JSON.stringify({
  mode: 'generate',
  title: 'Test',
  code: 'const PARAMS = {} as const; export const GeneratedAsset = () => null;',
  durationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
});

const stubClarifyJson = JSON.stringify({
  mode: 'clarify',
  questions: [
    {
      id: 'data_kind',
      question: '데이터 종류는?',
      choices: [
        { id: 'sales', label: '매출' },
        { id: 'users', label: '사용자수' },
      ],
    },
  ],
});

describe('generateAsset', () => {
  beforeEach(() => mockedChat.mockReset());

  it('returns clarify response when LLM mode=clarify', async () => {
    mockedChat.mockResolvedValueOnce(stubClarifyJson);
    const result = await generateAsset('애니메이션 만들어줘', 'haiku');
    expect(result.type).toBe('clarify');
    if (result.type === 'clarify') {
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].id).toBe('data_kind');
    }
  });

  it('returns generate response when LLM mode=generate', async () => {
    mockedChat.mockResolvedValueOnce(stubGenerateJson);
    const result = await generateAsset('Animated counter 0-100', 'haiku');
    expect(result.type).toBe('generate');
    if (result.type === 'generate') {
      expect(result.asset.title).toBe('Test');
      expect(result.asset.durationInFrames).toBe(150);
      expect(result.asset.id).toBeTruthy();
    }
  });

  it('passes answers in user message and forces generate', async () => {
    mockedChat.mockResolvedValueOnce(stubGenerateJson);
    await generateAsset('애니메이션 만들어줘', 'haiku', {
      answers: { data_kind: 'sales' },
    });
    const call = mockedChat.mock.calls[0][0];
    const userMsg = call.messages[0].content as string;
    expect(userMsg).toContain('[USER ANSWERS]');
    expect(userMsg).toContain('data_kind');
    expect(userMsg).toContain('sales');
  });

  it('throws when JSON missing', async () => {
    mockedChat.mockResolvedValueOnce('no json here');
    await expect(generateAsset('x', 'haiku')).rejects.toThrow(/JSON/i);
  });

  it('throws when generate code fails validation', async () => {
    const { validateCode } = jest.requireMock('@/lib/remotion/sandbox');
    (validateCode as jest.Mock).mockReturnValueOnce({ valid: false, errors: ['bad'] });
    mockedChat.mockResolvedValueOnce(stubGenerateJson);
    await expect(generateAsset('x', 'haiku')).rejects.toThrow(/security/i);
  });
});
