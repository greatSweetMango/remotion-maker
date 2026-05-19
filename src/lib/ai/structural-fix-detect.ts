/**
 * Structural-fix verb detection for the edit path (TM-174).
 *
 * Context — TM-86 + ADR-0023 (PARAMS strict isolation):
 *   /api/edit may ONLY change the minimal set of PARAMS keys the user explicitly
 *   names. It is forbidden from rewriting JSX layout, swapping component
 *   structure, or otherwise doing a full regeneration. This is correct for the
 *   common case (recolour, retitle, retiming) but creates a UX cliff when the
 *   user actually wants a structural redo: their prompt is silently constrained
 *   to a PARAMS tweak, the output looks unchanged, and they bounce.
 *
 * What this module does:
 *   Pre-classifies the edit prompt for "structural-fix verbs" — Korean and
 *   English terms that almost always indicate the user wants a full regenerate,
 *   not a PARAMS nudge. When matched, the API route SHORT-CIRCUITS the edit
 *   before any LLM call (so we don't waste tokens producing a no-op edit) and
 *   instructs the client to route to /api/generate via /studio with the same
 *   prompt.
 *
 * Design choice — REJECT rather than auto-route:
 *   Auto-pivoting an edit request into a regen would (a) destroy the existing
 *   asset's history without explicit consent, (b) re-bill a monthlyUsage slot
 *   the user did not opt into, and (c) misinterpret prompts that legitimately
 *   want a PARAMS-only tweak but happen to contain a borderline verb
 *   ("composition" inside a longer English sentence). Returning a structured
 *   error with a `suggestedAction` lets the client surface a one-click CTA
 *   ("Go regenerate from scratch") without taking irreversible action behind
 *   the user's back.
 *
 * False-positive policy:
 *   Word-boundary matching only. We intentionally do NOT match substrings
 *   inside longer words (e.g. "predetermined" must not trip "determined"-ish
 *   logic — we use explicit boundary regexes per term). Korean terms are
 *   matched by literal substring because Korean does not use ASCII word
 *   boundaries and the chosen tokens are unambiguous enough that substring
 *   matching has acceptable precision in practice (tested below).
 */

/** Result of structural-fix detection. */
export type StructuralFixDetection = {
  /** True when the prompt almost certainly wants a full regenerate. */
  triggered: boolean;
  /** The first matched verb/phrase (verbatim from the verb list), for logging + UX copy. */
  matchedTerm: string | null;
  /** Which language family the match came from — useful for picking the response message locale. */
  matchedLocale: 'ko' | 'en' | null;
};

/**
 * Korean structural-fix verbs.
 *
 * Substring-matched (no word boundaries — Korean lacks ASCII boundaries).
 * Each term was chosen to be unambiguous in an animation-edit context:
 *   - "재생성" — regenerate
 *   - "처음부터" — from scratch
 *   - "완전 새로" / "완전새로" — completely new
 *   - "구조 수정" / "구조수정" — structure fix
 *   - "레이아웃" — layout (as a structural noun, almost always means rebuild)
 *   - "컴포지션" — composition (transliteration)
 *   - "전체 새로" / "전체새로" — entirely new
 *   - "전부 다시" / "전부다시" — redo it all
 *
 * NOT included (too ambiguous — would over-trigger):
 *   - "다시" alone — frequently used in "조금만 다시 해줘" (small tweak), too generic
 *     on its own. We require it combined with structural context ("전부 다시" /
 *     "처음부터 다시"), which the listed phrases already capture.
 *   - "고쳐줘" — generic "fix it", routinely used for PARAMS edits.
 *   - "수정" alone — same problem as 다시; only "구조 수정" qualifies.
 */
const STRUCTURAL_VERBS_KO: readonly string[] = [
  '재생성',
  '처음부터',
  '완전 새로',
  '완전새로',
  '구조 수정',
  '구조수정',
  '레이아웃',
  '컴포지션',
  '전체 새로',
  '전체새로',
  '전부 다시',
  '전부다시',
  '다시 만들',
  '다시만들',
  '새로 만들',
  '새로만들',
];

/**
 * English structural-fix verbs/phrases.
 *
 * Word-boundary matched (case-insensitive). Multi-word phrases use \s+
 * to absorb extra spaces. Each term picked so that an in-context match
 * almost always indicates a regen intent:
 *   - regenerate / regen
 *   - redo (verb) — "redo the scene", "redo it"
 *   - "from scratch"
 *   - "start over"
 *   - "completely new" / "totally new" / "entirely new"
 *   - "full regen" / "full regeneration"
 *   - "structure fix" / "fix the structure" / "structural fix"
 *   - layout / composition (structural nouns — strong regen signal in this UX,
 *     since PARAMS never expose layout/composition controls)
 *   - rebuild / "rewrite from scratch"
 *
 * NOT included (too ambiguous):
 *   - "redesign" — sometimes used colloquially for "restyle" (PARAMS-level).
 *   - "fix" alone — overwhelmingly used for PARAMS tweaks.
 *   - "change" alone — generic.
 */
// Order matters: longer / more specific phrases MUST come before any of
// their substrings (e.g. `full regen` before `regen`, `rewrite from scratch`
// before `from scratch`) so the `matchedTerm` field surfaces the most
// informative label for logging and UX copy.
const STRUCTURAL_VERBS_EN: readonly { term: string; regex: RegExp }[] = [
  { term: 'rewrite from scratch', regex: /\brewrite\s+from\s+scratch\b/i },
  { term: 'full regen', regex: /\bfull\s+regen(eration)?\b/i },
  { term: 'fix the structure', regex: /\bfix\s+the\s+structure\b/i },
  { term: 'structural fix', regex: /\bstructural\s+fix\b/i },
  { term: 'structure fix', regex: /\bstructure\s+fix\b/i },
  { term: 'completely new', regex: /\bcompletely\s+new\b/i },
  { term: 'totally new', regex: /\btotally\s+new\b/i },
  { term: 'entirely new', regex: /\bentirely\s+new\b/i },
  { term: 'from scratch', regex: /\bfrom\s+scratch\b/i },
  { term: 'start over', regex: /\bstart\s+over\b/i },
  { term: 'regenerate', regex: /\bregenerate\b/i },
  { term: 'regen', regex: /\bregen\b/i },
  { term: 'redo', regex: /\bredo\b/i },
  { term: 'layout', regex: /\blayout\b/i },
  { term: 'composition', regex: /\bcomposition\b/i },
  { term: 'rebuild', regex: /\brebuild\b/i },
];

/**
 * Detect whether the given edit prompt is asking for a structural regenerate
 * rather than a PARAMS-level tweak.
 *
 * Returns `{ triggered: false, ... }` for non-string / empty input — the caller
 * (validatePrompt) handles those cases separately and we do not want to mask
 * its error code.
 *
 * Korean terms checked first since the product's primary audience is KR; on
 * an English prompt the KO loop is O(n*15) over short strings, negligible.
 */
export function detectStructuralFixRequest(prompt: unknown): StructuralFixDetection {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { triggered: false, matchedTerm: null, matchedLocale: null };
  }

  for (const verb of STRUCTURAL_VERBS_KO) {
    if (prompt.includes(verb)) {
      return { triggered: true, matchedTerm: verb, matchedLocale: 'ko' };
    }
  }

  for (const { term, regex } of STRUCTURAL_VERBS_EN) {
    if (regex.test(prompt)) {
      return { triggered: true, matchedTerm: term, matchedLocale: 'en' };
    }
  }

  return { triggered: false, matchedTerm: null, matchedLocale: null };
}

/**
 * Build the user-facing rejection payload for /api/edit when a structural-fix
 * verb is detected. Bilingual on purpose — the studio UI displays whichever
 * locale's text matches the user's input language, but always renders both so
 * the message is unambiguous regardless of UI locale state.
 *
 * `code: 'STRUCTURAL_REGEN_REQUIRED'` is a stable contract — the client uses it
 * to switch from inline error rendering to the "Go regenerate" CTA. Status 422
 * (Unprocessable Entity) is correct: the request is well-formed but its intent
 * cannot be satisfied by this endpoint.
 */
export type StructuralRegenRejection = {
  error: string;
  errorEn: string;
  code: 'STRUCTURAL_REGEN_REQUIRED';
  matchedTerm: string;
  matchedLocale: 'ko' | 'en';
  /** Client-side route to send the user to (with their prompt prefilled). */
  suggestedAction: {
    route: '/studio';
    queryParam: 'prompt';
  };
};

export function buildStructuralRegenRejection(
  detection: StructuralFixDetection,
): StructuralRegenRejection {
  if (!detection.triggered || !detection.matchedTerm || !detection.matchedLocale) {
    throw new Error('buildStructuralRegenRejection called on a non-triggered detection');
  }
  return {
    error:
      '이건 구조 변경 요청이라 편집(edit)으로는 처리할 수 없습니다. /studio로 이동해 같은 프롬프트로 새로 생성해주세요.',
    errorEn:
      'This looks like a structural change request, which the edit path cannot handle. Open /studio and regenerate from scratch with the same prompt.',
    code: 'STRUCTURAL_REGEN_REQUIRED',
    matchedTerm: detection.matchedTerm,
    matchedLocale: detection.matchedLocale,
    suggestedAction: { route: '/studio', queryParam: 'prompt' },
  };
}
