/**
 * TM-52 — clarify over-trigger guard tests.
 *
 * Verifies:
 *   1. The pure scoreConcreteness() classifier marks the dv-05 class of
 *      Korean specific prompts as concrete.
 *   2. Generic vague prompts ("애니메이션 만들어줘", "make something cool")
 *      remain non-concrete and continue to flow through clarify.
 *   3. End-to-end through generateAsset(): when the LLM mistakenly returns
 *      mode=clarify for a concrete KO prompt, the second forced-generate
 *      attempt is fired and its output is returned.
 *   4. End-to-end: vague prompts that legitimately get mode=clarify are
 *      surfaced unchanged (no override).
 */

import { scoreConcreteness, CONCRETENESS_THRESHOLD } from '@/lib/ai/clarify-gate';

describe('scoreConcreteness — KO false-positive prompts (TM-41 r1 retro)', () => {
  // The 5-prompt KO sample required by the TM-52 spec.
  const concreteKoPrompts = [
    '실시간 주식 시세 그래프 느낌',     // dv-05 original
    '예쁜 매출 차트',                   // variant: data + subject
    '쩌는 로고 인트로 빨간색',          // variant: subject + color
    '심플한 로딩 스피너 파란색 8개 점', // variant: style + subject + color + count
    '네온 사이버펑크 카운트다운 5초',   // variant: style + subject + count
  ];

  it.each(concreteKoPrompts)('classifies "%s" as concrete', (prompt) => {
    const r = scoreConcreteness(prompt);
    expect(r.isKorean).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(CONCRETENESS_THRESHOLD);
    expect(r.isConcrete).toBe(true);
  });

  it('still treats truly vague KO prompts as not-concrete', () => {
    const r = scoreConcreteness('애니메이션 만들어줘');
    expect(r.isConcrete).toBe(false);
  });

  it('still treats truly vague EN prompts as not-concrete', () => {
    const r = scoreConcreteness('make something cool');
    expect(r.isConcrete).toBe(false);
  });

  it('treats EN concrete prompts as concrete (parity)', () => {
    const r = scoreConcreteness('Animated counter from 0 to 100 with spring effect');
    expect(r.isConcrete).toBe(true);
  });

  it('Korean bias compensation: 1 KO signal alone should NOT be enough', () => {
    // The bias adds +1 only when at least one signal already fired, so a
    // bare subject with no other signals should still pass (subject + KO bias = 2).
    // But a single non-subject Korean word like "느낌" alone should not.
    const r = scoreConcreteness('느낌');
    expect(r.isConcrete).toBe(false);
  });
});

// --------------------------------------------------------------------------
// End-to-end guard wiring through generateAsset
// --------------------------------------------------------------------------

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

const SUBSTANTIVE_CODE = `const PARAMS = {
  primaryColor: "#7C3AED", // type: color
  speed: 1.0,
} as const;
export const GeneratedAsset = ({ primaryColor = PARAMS.primaryColor } = PARAMS) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1]);
  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <div style={{ color: primaryColor, opacity }}>주식 시세</div>
    </AbsoluteFill>
  );
};`;

const generateJson = JSON.stringify({
  mode: 'generate',
  title: '실시간 주식 시세',
  code: SUBSTANTIVE_CODE,
  durationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
});

const clarifyJson = JSON.stringify({
  mode: 'clarify',
  questions: [
    {
      id: 'data_kind',
      question: '어떤 데이터를?',
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
  ],
});

describe('generateAsset — TM-52 clarify-override wiring', () => {
  beforeEach(() => mockedChat.mockReset());

  it('overrides clarify→generate when LLM mistakenly clarifies a concrete KO prompt', async () => {
    mockedChat.mockResolvedValueOnce(clarifyJson);   // first attempt: clarify (false positive)
    mockedChat.mockResolvedValueOnce(generateJson);  // forced retry: generate
    const result = await generateAsset('실시간 주식 시세 그래프 느낌', 'haiku');
    expect(result.type).toBe('generate');
    if (result.type === 'generate') {
      expect(result.asset.title).toBe('실시간 주식 시세');
    }
    expect(mockedChat).toHaveBeenCalledTimes(2);
    // Second call's system prompt must contain the CLARIFY OVERRIDE block.
    const second = mockedChat.mock.calls[1][0];
    expect(second.system).toContain('CLARIFY OVERRIDE');
  });

  it('does NOT override clarify when prompt is genuinely vague', async () => {
    mockedChat.mockResolvedValueOnce(clarifyJson);
    const result = await generateAsset('애니메이션 만들어줘', 'haiku');
    expect(result.type).toBe('clarify');
    expect(mockedChat).toHaveBeenCalledTimes(1); // no forced retry
  });

  it('does NOT override clarify when caller already supplied answers', async () => {
    // If answers are present, the LLM SHOULD already be in mode=generate, but
    // even if it bounces to clarify (a separate bug) we must not loop.
    mockedChat.mockResolvedValueOnce(clarifyJson);
    const result = await generateAsset('실시간 주식 시세 그래프 느낌', 'haiku', {
      answers: { data_kind: 'sales' },
    });
    expect(result.type).toBe('clarify'); // surfaced as-is
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });
});
