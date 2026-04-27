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

// Substantive stub code that passes the TM-51 placeholder guard:
// has PARAMS w/ at least one customizable, JSX content, >200 chars, no `() => null`.
const SUBSTANTIVE_CODE = `const PARAMS = {
  primaryColor: "#7C3AED", // type: color
  speed: 1.0,              // type: range, min: 0.1, max: 3.0
} as const;
export const GeneratedAsset = ({ primaryColor = PARAMS.primaryColor, speed = PARAMS.speed } = PARAMS) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1]);
  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <div style={{ color: primaryColor, opacity, transform: 'scale(' + speed + ')' }}>Hello</div>
    </AbsoluteFill>
  );
};`;

const stubGenerateJson = JSON.stringify({
  mode: 'generate',
  title: 'Test',
  code: SUBSTANTIVE_CODE,
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

  it('repairs JS template-literal backticks emitted by smaller models', async () => {
    // gpt-4o-mini occasionally emits the `code` value as `…` instead of "…".
    // The tolerant extractor must repair this before JSON.parse.
    const codeBody = SUBSTANTIVE_CODE;
    const malformed = '{\n  "mode": "generate",\n  "title": "X",\n  "code": `' + codeBody + '`,\n  "durationInFrames": 150,\n  "fps": 30,\n  "width": 1920,\n  "height": 1080\n}';
    mockedChat.mockResolvedValueOnce(malformed);
    const result = await generateAsset('Animated counter 0-100', 'haiku');
    expect(result.type).toBe('generate');
    if (result.type === 'generate') {
      expect(result.asset.code).toContain('GeneratedAsset');
    }
  });

  it('throws when generate code fails validation', async () => {
    const { validateCode } = jest.requireMock('@/lib/remotion/sandbox');
    (validateCode as jest.Mock).mockReturnValueOnce({ valid: false, errors: ['bad'] });
    mockedChat.mockResolvedValueOnce(stubGenerateJson);
    await expect(generateAsset('x', 'haiku')).rejects.toThrow(/security/i);
  });
});

// TM-51: placeholder/empty-body guard for PRO model regressions.
import { detectPlaceholderCode } from '@/lib/ai/generate';

describe('detectPlaceholderCode (TM-51)', () => {
  it('rejects the canonical 25-char gpt-4o stub', () => {
    const stub = 'const Component = () => null;';
    const reasons = detectPlaceholderCode(stub);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes('PARAMS'))).toBe(true);
  });

  it('rejects empty PARAMS + null body even if PARAMS keyword present', () => {
    const stub = 'const PARAMS = {} as const; export const GeneratedAsset = () => null;';
    const reasons = detectPlaceholderCode(stub);
    expect(reasons.length).toBeGreaterThan(0);
    // Either the length check or the `=> null` check should fire.
    expect(
      reasons.some((r) => /too short|null/.test(r)),
    ).toBe(true);
  });

  it('rejects component with no JSX', () => {
    const stub =
      'const PARAMS = { x: 1 } as const;\n' +
      '// padding to push past the 200-char minimum so we exercise the JSX branch specifically.\n'.repeat(3) +
      'export const GeneratedAsset = () => { return "no jsx here, just a string return value"; };';
    const reasons = detectPlaceholderCode(stub);
    expect(reasons.some((r) => r.toLowerCase().includes('jsx'))).toBe(true);
  });

  it('accepts substantive code with PARAMS + JSX + sufficient length', () => {
    const good = `const PARAMS = {
      primaryColor: "#7C3AED", // type: color
      speed: 1.0,              // type: range
    } as const;
    export const GeneratedAsset = ({ primaryColor = PARAMS.primaryColor } = PARAMS) => {
      const frame = useCurrentFrame();
      const opacity = interpolate(frame, [0, 30], [0, 1]);
      return (
        <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
          <div style={{ color: primaryColor, opacity }}>Hi</div>
        </AbsoluteFill>
      );
    };`;
    expect(detectPlaceholderCode(good)).toEqual([]);
  });
});

describe('generateAsset retry on placeholder (TM-51)', () => {
  beforeEach(() => mockedChat.mockReset());

  const placeholderJson = JSON.stringify({
    mode: 'generate',
    title: 'Stub',
    code: 'const Component = () => null;',
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  });

  it('retries once when first response is a placeholder, succeeds on second', async () => {
    mockedChat.mockResolvedValueOnce(placeholderJson);
    mockedChat.mockResolvedValueOnce(stubGenerateJson);
    const result = await generateAsset('A loader spinner', 'gpt-4o');
    expect(mockedChat).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('generate');
    // Second call should use the reinforced system prompt.
    const secondCall = mockedChat.mock.calls[1][0];
    expect(secondCall.system).toContain('ANTI-PLACEHOLDER ENFORCEMENT');
  });

  it('throws after two consecutive placeholder responses', async () => {
    mockedChat.mockResolvedValueOnce(placeholderJson);
    mockedChat.mockResolvedValueOnce(placeholderJson);
    await expect(generateAsset('A loader spinner', 'gpt-4o')).rejects.toThrow(
      /placeholder|empty component/i,
    );
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });
});
