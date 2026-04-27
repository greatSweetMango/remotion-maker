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
}

/** Threshold above which clarify is treated as a false positive. */
export const CONCRETENESS_THRESHOLD = 2;

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

  return {
    score,
    isConcrete: score >= CONCRETENESS_THRESHOLD,
    hits,
    isKorean,
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
