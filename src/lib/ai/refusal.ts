/**
 * TM-59 — adversarial / refusal message classification.
 *
 * Discovery (TM-45 fuzz, D1-D7): when a user prompt asks the LLM to embed
 * unsafe code (`<script>`, `eval`, `document.cookie`, `new Worker`, ...) or
 * tries to override the system instruction, the LLM tends to refuse with a
 * short prose message rather than the requested JSON. `extractJson` then
 * returns null and we surface a generic "AI did not return valid JSON" to
 * the user — misleading because the actual cause is a safety/policy
 * decision, not a parsing bug.
 *
 * This module classifies a raw refusal blurb into one of:
 *   - `safety`        — content policy: violence / hate / sexual / self-harm
 *   - `adversarial`   — prompt-injection / jailbreak / system-override attempt
 *   - `policy`        — generic refusal we can detect but not categorize
 *   - `unknown`       — no refusal signal at all (probably a real malformed
 *                       JSON; surface the legacy error)
 *
 * Mapping from category to user-facing message lives in `refusalMessage`.
 *
 * Important non-goals:
 *   - We do NOT echo the prompt back. The user already knows what they typed.
 *   - We do NOT reveal which deny-list pattern triggered. Doing so would
 *     leak bypass guidance ("Forbidden: Worker" was already a small leak —
 *     keep this layer above sandbox-detail-level).
 *   - We do NOT try to "fix" the prompt. Just clarify the failure mode.
 */

export type RefusalCategory = 'safety' | 'adversarial' | 'policy' | 'unknown';

export interface RefusalClassification {
  category: RefusalCategory;
  /** Optional debugging signal (which heuristic matched). Not user-facing. */
  matchedHint?: string;
}

/**
 * Light-weight refusal-prose heuristics. We deliberately keep these as
 * narrow, conservative regexes — false positives here would re-label real
 * "malformed JSON" bugs as policy refusals and hide actual issues.
 *
 * Order matters: we test `adversarial` (system-override) before `safety`
 * because a prompt injection trying to extract content can also trip safety
 * keywords, and the adversarial framing is the more specific finding.
 */
const ADVERSARIAL_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  // English
  { re: /\bignore\s+(the\s+)?(previous|prior|above)\s+(instructions?|prompt|system)/i, hint: 'en:ignore-previous' },
  { re: /\boverride\s+(my|the)\s+(system|safety|previous)\s+(instructions?|prompt)/i, hint: 'en:override' },
  // Match "reveal the system prompt", "reveal the hidden system prompt",
  // "leak system instructions", etc. Up to 3 word slots between the verb
  // and prompt|instructions to tolerate "(the) (hidden) (system)".
  { re: /\b(reveal|leak|disclose)\s+(?:\w+\s+){0,3}(prompt|instructions?)/i, hint: 'en:reveal-system' },
  { re: /\bjailbreak/i, hint: 'en:jailbreak' },
  { re: /\bprompt\s+injection/i, hint: 'en:prompt-injection' },
  // Korean
  { re: /(시스템|이전)\s*(지시|프롬프트|명령).*(무시|변경|덮어쓰)/, hint: 'ko:system-override' },
];

const SAFETY_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  // English — refusal blurbs tend to use these phrasings
  { re: /\b(content|usage|safety)\s+polic(y|ies)/i, hint: 'en:content-policy' },
  { re: /\b(I('|\s)?m|I\s+am)\s+sorry,?\s+(but\s+)?I\s+(can('|\s)?t|cannot)/i, hint: 'en:sorry-cant' },
  { re: /\bI\s+(can('|\s)?t|cannot|won('|\s)?t|will\s+not)\s+(help|assist|comply|provide|generate|create)/i, hint: 'en:cant-help' },
  { re: /\b(violence|hate(\s+speech)?|sexual|self[-\s]?harm|harassment|extremism|illicit|illegal\s+activity)\b/i, hint: 'en:harm-keyword' },
  { re: /\bunsafe\s+(content|code|behavior)\b/i, hint: 'en:unsafe-content' },
  { re: /\bnot\s+(able|allowed)\s+to\s+(help|assist|generate|create|provide)/i, hint: 'en:not-allowed' },
  // Korean
  { re: /(폭력|혐오|성적|자해|불법|증오)/, hint: 'ko:harm-keyword' },
  { re: /(안전|콘텐츠|이용)\s*정책/, hint: 'ko:content-policy' },
  { re: /(도와드릴\s*수\s*없|처리할\s*수\s*없|제공할\s*수\s*없|응답할\s*수\s*없)/, hint: 'ko:cant-help' },
];

const GENERIC_REFUSAL_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  { re: /\bI\s+(can('|\s)?t|cannot)\b/i, hint: 'en:generic-cant' },
  { re: /\b(sorry|apolog(ize|ies))\b/i, hint: 'en:sorry' },
  { re: /(죄송|미안)/, hint: 'ko:sorry' },
];

/**
 * Decide whether a raw LLM blurb looks like a refusal (vs. a malformed JSON
 * attempt that just happened to fail to parse). Heuristic — when in doubt,
 * we return `unknown` so the caller surfaces the legacy "did not return
 * valid JSON" rather than a wrong policy explanation.
 */
export function classifyRefusal(rawText: string | null | undefined): RefusalClassification {
  if (!rawText || typeof rawText !== 'string') return { category: 'unknown' };

  // Cheap exit: if the response actually contains a JSON object opening,
  // it's not really a refusal — it's a structural failure. Caller handles.
  // (We still continue if there's a `{` because some refusals are wrapped
  // in markdown that incidentally has braces. Quick heuristic only.)
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return { category: 'unknown' };

  for (const { re, hint } of ADVERSARIAL_PATTERNS) {
    if (re.test(trimmed)) return { category: 'adversarial', matchedHint: hint };
  }
  for (const { re, hint } of SAFETY_PATTERNS) {
    if (re.test(trimmed)) return { category: 'safety', matchedHint: hint };
  }
  for (const { re, hint } of GENERIC_REFUSAL_PATTERNS) {
    if (re.test(trimmed)) return { category: 'policy', matchedHint: hint };
  }
  return { category: 'unknown' };
}

/**
 * User-facing Korean message for a refusal category.
 *
 * Wording rules:
 *   - Tell the user WHY (category) without revealing the deny-list / system
 *     prompt.
 *   - Suggest a corrective action they can take ("프롬프트를 다시 작성").
 *   - Stay short — this lands in a toast.
 */
export function refusalMessage(category: RefusalCategory): string {
  switch (category) {
    case 'safety':
      return '이 요청은 안전 정책상 처리하기 어렵습니다. 프롬프트를 다시 작성해 주세요.';
    case 'adversarial':
      return '프롬프트가 시스템 지시를 변경하려 하기 때문에 처리할 수 없습니다. 일반적인 영상 설명으로 다시 작성해 주세요.';
    case 'policy':
      return '이 요청은 처리할 수 없습니다. 프롬프트를 다시 작성해 주세요.';
    case 'unknown':
    default:
      // Caller decides — typically the legacy "AI did not return valid JSON"
      // message is more appropriate here (real parser failure).
      return 'AI 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

/**
 * Error code for the API response body. Lets the client (and tests)
 * distinguish refusals from generic 5xx without parsing the message.
 */
export function refusalCode(category: RefusalCategory): string {
  switch (category) {
    case 'safety':
      return 'AI_REFUSAL_SAFETY';
    case 'adversarial':
      return 'AI_REFUSAL_ADVERSARIAL';
    case 'policy':
      return 'AI_REFUSAL_POLICY';
    case 'unknown':
    default:
      return 'AI_PARSE_FAILED';
  }
}

/**
 * Custom error class that carries the refusal category through the
 * generateAsset → /api/generate boundary. The route handler unwraps it to
 * shape the HTTP response.
 */
export class AiRefusalError extends Error {
  readonly category: RefusalCategory;
  readonly code: string;
  readonly matchedHint?: string;

  constructor(classification: RefusalClassification) {
    const message = refusalMessage(classification.category);
    super(message);
    this.name = 'AiRefusalError';
    this.category = classification.category;
    this.code = refusalCode(classification.category);
    this.matchedHint = classification.matchedHint;
  }
}
