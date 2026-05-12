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

import {
  scoreConcreteness,
  CONCRETENESS_THRESHOLD,
  extractEntityCount,
  ENTITY_COUNT_SKIP_THRESHOLD,
  buildEntityCountReinforcement,
} from '@/lib/ai/clarify-gate';

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
    // TM-105 — vague + clarify path now also fires the dynamic question
    // generator. We mock it to return non-JSON so the code falls back to the
    // primary's questions. End-result must still be a clarify response.
    mockedChat.mockResolvedValueOnce('not-json');
    const result = await generateAsset('애니메이션 만들어줘', 'haiku');
    expect(result.type).toBe('clarify');
    // 1 primary + 1 dynamic clarify-questions call (TM-105). No forced retry.
    expect(mockedChat).toHaveBeenCalledTimes(2);
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

// --------------------------------------------------------------------------
// TM-68 — entity-count gate
// --------------------------------------------------------------------------

describe('extractEntityCount — TM-68', () => {
  it.each([
    ['실시간 주식 시세 그래프 느낌, 빨강/초록 캔들, 8개 막대', 8],
    ['3가지 특징 아이콘+텍스트: 빠른 속도, 안정성, 보안', 3],
    ['5 bars chart with neon glow', 5],
    ['3x3 grid of icons', 9],
    ['7개 단계 progress', 7],
    ['12 items rotating', 12],
    ['10단계 로딩 바', 10],
  ])('extracts entity count from "%s" → %i', (prompt, expected) => {
    expect(extractEntityCount(prompt)).toBe(expected);
  });

  it('returns 0 when no entity counter is present', () => {
    expect(extractEntityCount('make something cool')).toBe(0);
    expect(extractEntityCount('애니메이션 만들어줘')).toBe(0);
  });

  it('ignores duration-only counters (seconds, fps, frames)', () => {
    // "5초", "30s", "60fps" describe time, not entity count.
    expect(extractEntityCount('5초 카운트다운')).toBe(0);
    expect(extractEntityCount('30s intro animation at 60fps')).toBe(0);
    expect(extractEntityCount('Before 30s vs After 5s, red vs green')).toBe(0);
  });

  it('takes the maximum when multiple counters appear', () => {
    expect(extractEntityCount('3개 카드, 8개 막대')).toBe(8);
  });

  it('handles grid notation NxM as a product', () => {
    expect(extractEntityCount('5x4 grid')).toBe(20);
  });
});

describe('scoreConcreteness — TM-68 forceSkipClarify', () => {
  it('flags forceSkipClarify when explicit entity count ≥ threshold', () => {
    const r = scoreConcreteness('실시간 주식 시세 그래프 느낌, 빨강/초록 캔들, 8개 막대');
    expect(r.entityCount).toBe(8);
    expect(r.entityCount).toBeGreaterThanOrEqual(ENTITY_COUNT_SKIP_THRESHOLD);
    expect(r.forceSkipClarify).toBe(true);
  });

  it('flags forceSkipClarify for "3가지 특징" (ig-02 class)', () => {
    const r = scoreConcreteness('3가지 특징 아이콘+텍스트: 빠른 속도, 안정성, 보안');
    expect(r.entityCount).toBe(3);
    expect(r.forceSkipClarify).toBe(true);
  });

  it('flags forceSkipClarify when ≥ 3 distinct concrete categories fire (no count)', () => {
    // ig-03: subject-less but lots of color + count + punctuation → multi-category.
    const r = scoreConcreteness('Comparison side-by-side: "Before 30s" vs "After 5s", red vs green');
    expect(r.entityCount).toBe(0); // duration counters excluded
    expect(r.hits.length).toBeGreaterThanOrEqual(3);
    expect(r.forceSkipClarify).toBe(true);
  });

  it('does NOT flag forceSkipClarify for thin prompts', () => {
    const r = scoreConcreteness('애니메이션 만들어줘');
    expect(r.forceSkipClarify).toBe(false);
    expect(r.entityCount).toBe(0);
  });

  it('does NOT flag forceSkipClarify for entityCount = 1 alone', () => {
    // "1 item" — only one entity AND no other strong signals → should not skip.
    const r = scoreConcreteness('1 item');
    expect(r.entityCount).toBe(1);
    expect(r.forceSkipClarify).toBe(false);
  });
});

describe('scoreConcreteness — visual-domain signal gate', () => {
  // Pure count+length (no visual signal) MUST NOT bypass clarify. The LLM
  // can produce a quality result only when it knows HOW the output should
  // look — duration alone doesn't tell it that. Discovered with the
  // "곰돌이가 초원을 걸어가는 10초" prompt: model emitted skeleton placeholder
  // because it had no style cue and no clarify was asked.
  it('suppresses isConcrete when only count+length hits (no visual signal)', () => {
    const r = scoreConcreteness('곰돌이 캐릭터가 초원을 걸어가는 10초가량의 애니메이션 만들어줘');
    // Should hit count (10초) + length; no subject (곰돌이 not in SUBJECT_PATTERNS),
    // no color, no style, no data.
    expect(r.hits).toContain('count');
    expect(r.hits).toContain('length');
    expect(r.hits).not.toContain('color');
    expect(r.hits).not.toContain('style');
    expect(r.isConcrete).toBe(false);
    expect(r.forceSkipClarify).toBe(false);
  });

  it('keeps isConcrete when count+length + style signal present', () => {
    const r = scoreConcreteness('미니멀 곰돌이 걷기 10초 애니메이션');
    expect(r.hits).toContain('style'); // 미니멀
    expect(r.isConcrete).toBe(true);
  });

  it('keeps isConcrete when count+length + color signal present', () => {
    const r = scoreConcreteness('빨간 동물 캐릭터 10초 애니메이션');
    expect(r.hits).toContain('color'); // 빨간
    expect(r.isConcrete).toBe(true);
  });

  it('keeps motion-graphics prompts (have subject hit) concrete', () => {
    const r = scoreConcreteness('카운터 0~100, 3초');
    expect(r.hits).toContain('subject'); // 카운터
    expect(r.isConcrete).toBe(true);
  });
});

// --------------------------------------------------------------------------
// TM-95 — data-viz over-clarify regression (5 prompts from TM-85 r1)
// --------------------------------------------------------------------------

describe('scoreConcreteness — TM-95 data-viz prompts (TM-85 r1 regression)', () => {
  // The exact 5 data-viz prompts that 100% over-triggered clarify in TM-85 r1.
  // After TM-95 widening, all 5 MUST be classified as concrete AND
  // forceSkipClarify=true so the hardened retry can rescue them if the LLM
  // still misbehaves.
  const dataVizPrompts = [
    'Bar chart top 5 products by revenue',
    '막대 그래프 매출 상위 10',
    'Pie chart device breakdown 4 segments',
    'Line chart stock price daily',
    'Donut chart user signups',
  ];

  it.each(dataVizPrompts)('classifies "%s" as concrete + forceSkipClarify', (prompt) => {
    const r = scoreConcreteness(prompt);
    expect(r.isConcrete).toBe(true);
    // Either subject+data or category-count path must trigger forceSkipClarify.
    expect(r.forceSkipClarify).toBe(true);
  });

  it('expanded DATA_PATTERNS catches "signups" / "breakdown" / "daily" / "device"', () => {
    expect(scoreConcreteness('Donut chart user signups').hits).toContain('data');
    expect(scoreConcreteness('Pie chart device breakdown 4 segments').hits).toContain('data');
    expect(scoreConcreteness('Line chart stock price daily').hits).toContain('data');
  });

  it('expanded COUNT_PATTERNS catches "4 segments" / "5 products"', () => {
    expect(scoreConcreteness('Pie chart device breakdown 4 segments').hits).toContain('count');
    expect(scoreConcreteness('Bar chart top 5 products by revenue').hits).toContain('count');
  });
});

describe('generateAsset — TM-95 data-viz hardened retry', () => {
  beforeEach(() => mockedChat.mockReset());

  it('fires TM-95 dataviz hardened retry for "Donut chart user signups"', async () => {
    // subject (donut/chart) + data (signups/users), no entity count.
    // Expected sequence: clarify → forced clarify → TM-95 dataviz hardened → generate
    mockedChat.mockResolvedValueOnce(clarifyJson);
    mockedChat.mockResolvedValueOnce(clarifyJson);
    mockedChat.mockResolvedValueOnce(generateJson);
    const result = await generateAsset('Donut chart user signups', 'haiku');
    expect(result.type).toBe('generate');
    expect(mockedChat).toHaveBeenCalledTimes(3);
    const third = mockedChat.mock.calls[2][0];
    expect(third.system).toContain('DATA-VIZ SUBJECT');
    expect(third.system).toContain('TM-95');
  });

  it('TM-52 forced retry alone is enough when LLM cooperates (no 3rd call)', async () => {
    mockedChat.mockResolvedValueOnce(clarifyJson);
    mockedChat.mockResolvedValueOnce(generateJson);
    const result = await generateAsset('Bar chart top 5 products by revenue', 'haiku');
    expect(result.type).toBe('generate');
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });
});

describe('buildEntityCountReinforcement — TM-68', () => {
  it('quotes the entity count back to the model', () => {
    const r = buildEntityCountReinforcement(8);
    expect(r).toContain('ENTITY COUNT');
    expect(r).toContain('TM-68');
    expect(r).toContain('8');
    expect(r).toContain('mode="generate"');
  });
});

describe('generateAsset — TM-68 entity-count hardened retry', () => {
  beforeEach(() => mockedChat.mockReset());

  it('does a 3rd hardened retry when forced retry still returns clarify (entity count present)', async () => {
    // dv-05 prompt: 8개 막대 → entityCount=8 → forceSkipClarify
    mockedChat.mockResolvedValueOnce(clarifyJson);  // 1st: clarify
    mockedChat.mockResolvedValueOnce(clarifyJson);  // 2nd (TM-52 forced): still clarify
    mockedChat.mockResolvedValueOnce(generateJson); // 3rd (TM-68 hardened): finally generates
    const result = await generateAsset(
      '실시간 주식 시세 그래프 느낌, 빨강/초록 캔들, 8개 막대',
      'haiku',
    );
    expect(result.type).toBe('generate');
    expect(mockedChat).toHaveBeenCalledTimes(3);
    // 3rd call's system prompt must contain the TM-68 entity-count override.
    const third = mockedChat.mock.calls[2][0];
    expect(third.system).toContain('ENTITY COUNT');
    expect(third.system).toContain('TM-68');
    // And it must have quoted the count.
    expect(third.system).toContain('8');
  });

  it('TM-95: fires 3rd hardened retry (dataviz variant) when forceSkipClarify=true with no entity count', async () => {
    // "Comparison side-by-side ... red vs green" → forceSkipClarify by hits≥3
    // (color/count/punctuation), entityCount=0. Under TM-95, hardened retry
    // now fires for ANY forceSkipClarify=true (not just entityCount>0) using
    // the TM-95 dataviz reinforcement.
    mockedChat.mockResolvedValueOnce(clarifyJson);  // 1st
    mockedChat.mockResolvedValueOnce(clarifyJson);  // 2nd (TM-52 forced) — still clarify
    mockedChat.mockResolvedValueOnce(generateJson); // 3rd (TM-95 hardened) — generates
    const result = await generateAsset(
      'Comparison side-by-side: "Before 30s" vs "After 5s", red vs green',
      'haiku',
    );
    expect(result.type).toBe('generate');
    expect(mockedChat).toHaveBeenCalledTimes(3);
    // The 3rd call must NOT contain the entity-count wording (entityCount=0).
    const third = mockedChat.mock.calls[2][0];
    expect(third.system).toContain('DATA-VIZ SUBJECT');
    expect(third.system).toContain('TM-95');
    expect(third.system).not.toContain('ENTITY COUNT');
  });

  it('returns generate immediately if TM-52 forced retry succeeded (no 3rd call)', async () => {
    mockedChat.mockResolvedValueOnce(clarifyJson);
    mockedChat.mockResolvedValueOnce(generateJson);
    const result = await generateAsset(
      '실시간 주식 시세 그래프 느낌, 빨강/초록 캔들, 8개 막대',
      'haiku',
    );
    expect(result.type).toBe('generate');
    expect(mockedChat).toHaveBeenCalledTimes(2); // no 3rd retry needed
  });
});
