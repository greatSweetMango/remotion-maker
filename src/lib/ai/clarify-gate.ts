/**
 * TM-52 — clarify over-trigger guard.
 *
 * Background: TM-41 r1 QA found that Korean prompts that were objectively
 * specific (e.g. "실시간 주식 시세 그래프 느낌" — names a subject, data type,
 * AND visual style) still tripped `mode=clarify` from the LLM at a much
 * higher rate than the equivalent English phrasing. The cause is that the
 * LLM's "ambiguity" judgment is biased by character count, and Korean
 * conveys far more meaning per character than English — short KO prompts
 * look "thin" to a model trained mostly on English.
 *
 * Strategy (cheap, deterministic, prompt-agnostic):
 *   1. Score the prompt against a list of *concreteness signals* — explicit
 *      subjects, colors, counts, timing, named effects, data sources.
 *   2. KO-aware: many signals carry doubled weight when seen in Korean text
 *      because they are rarer relative to overall token count.
 *   3. If the score crosses a threshold, the prompt is "concrete enough"
 *      and any `mode=clarify` from the LLM is treated as a false positive.
 *      The caller retries once with a forced-generate directive.
 *
 * Caller wiring lives in `generate.ts` — see `generateOnce`.
 */

const KO_REGEX = /[ㄱ-힝]/;

/** Concrete subject nouns that obviate a clarifying question. */
const SUBJECT_PATTERNS: RegExp[] = [
  // English
  /\b(counter|spinner|loader|button|chart|graph|bar|pie|line|donut|timeline|logo|text|title|card|modal|particle|orbit|grid|wave|spiral|tunnel|globe|cube|sphere|tree|flow|map|gauge|progress)\b/i,
  // Korean concrete subjects
  /(카운터|스피너|로더|버튼|차트|그래프|막대|선|원형|도넛|로고|텍스트|타이틀|카드|입자|파티클|궤도|그리드|물결|파동|나선|터널|지구본|큐브|구체|트리|흐름|지도|게이지|진행|프로그레스|주식|시세|매출|순위|랭킹|타이머|시계|달력|체크|로딩)/,
];

/** Color signals — hex, rgb, named, KO color words. */
const COLOR_PATTERNS: RegExp[] = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\brgba?\s*\(/i,
  /\b(red|blue|green|yellow|black|white|purple|orange|pink|cyan|magenta|gray|grey|gold|silver|teal|indigo|violet|crimson|navy|lime|olive|maroon)\b/i,
  /(빨강|빨간|파랑|파란|초록|녹색|노랑|노란|검정|검은|하양|흰|보라|보랏빛|주황|분홍|핑크|회색|금색|은색|청록|남색|민트|네온)/,
];

/** Counts / enumerations like "5 bars", "3가지", "7개". */
const COUNT_PATTERNS: RegExp[] = [
  /\b\d+\s*(items?|elements?|bars?|dots?|circles?|squares?|stars?|lines?|columns?|rows?|sections?|panels?|tiles?|steps?|frames?|seconds?|s|fps)\b/i,
  /\d+\s*(가지|개|단계|단|초|개월|회|번|컷)/,
  /\d+\s*x\s*\d+/i, // grid like 3x3
];

/** Style / effect named techniques — strong specificity. */
const STYLE_PATTERNS: RegExp[] = [
  /\b(spring|bounce|fade|slide|zoom|rotate|pulse|glitch|typewriter|parallax|gradient|neon|glow|blur|shake|wobble|drift|orbit|particle|flame|smoke|liquid|fluid|3d|isometric|monospace|comic|retro|vintage|minimal|flat|skeuomorphic)\b/i,
  /(스프링|바운스|페이드|슬라이드|줌|회전|펄스|글리치|타이핑|타이프라이터|패럴랙스|그라디언트|네온|글로우|블러|흔들|진동|드리프트|입자|불꽃|연기|액체|유체|3D|아이소메트릭|모노스페이스|레트로|빈티지|미니멀|플랫)/,
];

/** Domain / data-source signals. */
const DATA_PATTERNS: RegExp[] = [
  /\b(sales|revenue|users|stock|price|score|rank|ranking|temperature|weather|growth|kpi|metric|dashboard|live|real-?time)\b/i,
  /(매출|수익|사용자|주식|가격|점수|순위|랭킹|기온|날씨|성장|지표|실시간|라이브)/,
];

export interface ConcretenessReport {
  score: number;
  /** Whether the prompt should bypass the clarify path. */
  isConcrete: boolean;
  /** Signal categories that fired. Useful for logging. */
  hits: Array<'subject' | 'color' | 'count' | 'style' | 'data' | 'length' | 'punctuation'>;
  /** True iff the prompt contains Hangul. */
  isKorean: boolean;
  /**
   * TM-68 — explicit entity count extracted from the prompt. Examples:
   *   - "8개 막대" → 8
   *   - "3가지 특징" → 3
   *   - "5 bars" → 5
   *   - no count → 0
   * Time-only counters ("30s", "5초") are excluded; they describe duration,
   * not entity multiplicity.
   */
  entityCount: number;
  /**
   * TM-68 — strong-skip flag. When true, the caller should NOT surface
   * mode=clarify even if the LLM keeps returning it; one extra forced
   * retry with a hardened directive is warranted. Set when the prompt
   * carries an explicit entity count ≥ 2 OR ≥ 3 distinct concreteness
   * categories — both indicate the user has already enumerated enough
   * structure that asking back-and-forth questions is the wrong UX.
   */
  forceSkipClarify: boolean;
}

/** Threshold above which clarify is treated as a false positive. */
export const CONCRETENESS_THRESHOLD = 2;

/**
 * TM-68 — minimum entity count that triggers `forceSkipClarify`.
 * "3가지 특징" or "8개 막대" → user already enumerated; no need to ask back.
 */
export const ENTITY_COUNT_SKIP_THRESHOLD = 2;

/**
 * TM-68 — entity-count counters. KO unit nouns and EN plurals that count
 * *things* (not seconds/frames/fps). Order matters only for readability.
 *
 * Excluded by design: 초/s/seconds/fps/frame/ms — these are duration units
 * and don't tell us anything about entity multiplicity.
 */
const ENTITY_COUNTER_RE = new RegExp(
  [
    // Korean entity counters
    '\\d+\\s*(?:가지|개|단계|단|회|번|컷|항목|요소|줄|행|열|칸|장|쪽|페이지)',
    // English entity counters (plural nouns)
    '\\d+\\s*(?:items?|elements?|bars?|dots?|circles?|squares?|stars?|lines?|columns?|rows?|sections?|panels?|tiles?|steps?|points?|nodes?|cards?|icons?)\\b',
    // Grid notation NxM — entity count = N*M (handled separately)
    '\\d+\\s*x\\s*\\d+',
  ].join('|'),
  'gi',
);

/**
 * TM-68 — extract the maximum explicit entity count in a prompt.
 *
 * Returns 0 when no entity counter is found. The intent is to recognize
 * prompts where the user has already named *how many* things to render
 * ("3가지 특징", "8개 막대", "5 bars", "3x3 grid"). Such prompts should
 * never be sent through clarify — the structure is already specified.
 */
export function extractEntityCount(prompt: string): number {
  const text = prompt ?? '';
  let max = 0;
  // Reset stateful regex (the `g` flag is shared across calls).
  ENTITY_COUNTER_RE.lastIndex = 0;
  for (const m of text.matchAll(ENTITY_COUNTER_RE)) {
    const segment = m[0];
    // Grid: NxM → product is the entity count.
    const grid = segment.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (grid) {
      const product = parseInt(grid[1], 10) * parseInt(grid[2], 10);
      if (product > max) max = product;
      continue;
    }
    const num = segment.match(/^\d+/);
    if (!num) continue;
    const n = parseInt(num[0], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Score a prompt for concreteness. Pure, no I/O.
 *
 * Each category that fires is +1. Korean prompts get a +1 boost when they
 * already have at least one signal — this counteracts the LLM's bias against
 * short Korean text. The threshold (default 2) is intentionally low: the goal
 * is to catch the dv-05 class of false positives, not to silence the LLM
 * whenever the user is vague.
 */
export function scoreConcreteness(prompt: string): ConcretenessReport {
  const text = (prompt ?? '').trim();
  const isKorean = KO_REGEX.test(text);
  const hits: ConcretenessReport['hits'] = [];

  if (SUBJECT_PATTERNS.some((r) => r.test(text))) hits.push('subject');
  if (COLOR_PATTERNS.some((r) => r.test(text))) hits.push('color');
  if (COUNT_PATTERNS.some((r) => r.test(text))) hits.push('count');
  if (STYLE_PATTERNS.some((r) => r.test(text))) hits.push('style');
  if (DATA_PATTERNS.some((r) => r.test(text))) hits.push('data');

  // Quoted text is a strong specificity signal (the user named exact
  // copy to render). Catches things like: 타이핑 효과 "Hello World".
  if (/"[^"]{2,}"|'[^']{2,}'|"[^"]{2,}"|'[^']{2,}'/.test(text)) hits.push('punctuation');

  // Length signal — prompts of nontrivial length almost always disambiguate
  // themselves through context, regardless of language. We use byte length
  // as a coarse proxy because Korean characters are 3 bytes in UTF-8.
  const byteLen = Buffer.byteLength(text, 'utf8');
  if (byteLen >= 40) hits.push('length');

  let score = hits.length;
  // KO bias compensation: if Korean and we already have any concrete signal,
  // give it one more point so a 4-word KO prompt with a subject + style ties
  // an 8-word EN equivalent.
  if (isKorean && score >= 1) score += 1;

  // TM-68 — entity-count gate. An explicit "N things" enumeration is the
  // strongest possible specificity signal; the user has literally counted
  // for us. Independent of language.
  const entityCount = extractEntityCount(text);
  const forceSkipClarify =
    entityCount >= ENTITY_COUNT_SKIP_THRESHOLD || hits.length >= 3;

  return {
    score,
    isConcrete: score >= CONCRETENESS_THRESHOLD,
    hits,
    isKorean,
    entityCount,
    forceSkipClarify,
  };
}

/**
 * Reinforcement appended when a clarify response is over-triggered for a
 * concrete prompt. Forces the model into mode=generate on retry without
 * letting it swap back to clarify.
 */
export const FORCE_GENERATE_REINFORCEMENT = `

============== CLARIFY OVERRIDE (TM-52) ==============

The previous response chose mode="clarify" but the user's prompt already
contains enough concrete signals (subject, style, color, count, or named
data) to produce an animation with reasonable defaults. Re-read the prompt
and produce the asset now. You MUST set "mode": "generate" — do not return
mode="clarify" again. If a detail is missing, choose a sensible default
(e.g. brand-neutral colors, 150 frames @ 30fps, single composition) rather
than asking.
`;

/**
 * TM-68 — hardened clarify override used when the user's prompt carries an
 * explicit entity count (e.g. "8개 막대", "3가지 특징", "5 bars"). Two
 * earlier attempts (standard + TM-52 force-generate) BOTH still returned
 * clarify; this directive is the last-chance override before we surface a
 * user-facing error. The wording here is intentionally absolute and quotes
 * the extracted count back to the model.
 */
export function buildEntityCountReinforcement(entityCount: number): string {
  return `

============== CLARIFY OVERRIDE — ENTITY COUNT (TM-68) ==============

The user's prompt contains an EXPLICIT entity count of ${entityCount}.
This is the strongest possible specificity signal — the user has literally
told you how many things to render. Returning mode="clarify" is forbidden.

You MUST output mode="generate". Render exactly ${entityCount} of whatever
the prompt enumerates (bars, items, features, points, …). For any styling
detail that is genuinely missing, pick a tasteful default — DO NOT ASK.

This is your final attempt. Do not return clarify again under any
circumstances.
`;
}
