/**
 * TM-105 — dynamic prompt-tailored clarify question generation.
 *
 * Background: TM-11 / GEN-06 wired clarify mode into the main generation
 * call; the LLM both decides "clarify vs generate" AND emits the questions
 * in the same JSON. In practice the questions came back generic (almost
 * always "데이터 종류?" with sales/users/ranking choices) because the
 * single-shot prompt over-anchors to the example we showed it.
 *
 * This module adds a SECOND, dedicated LLM call that runs only after the
 * primary call elects mode="clarify". It is given a prompt focused purely
 * on producing 3-5 questions specifically tailored to what THIS user
 * prompt is missing — style, BGM mood, text overlay, palette, pacing,
 * subject details, etc. Questions are language-matched to the user input.
 *
 * Why a second call rather than tightening the original prompt:
 *   - Mode decision and question generation have different optimal prompts.
 *     The mode decision must be permissive about generation; the question
 *     generation must be expansive about *what could be asked*.
 *   - Separating them lets us tune & test independently, and lets the
 *     question generator use a smaller/cheaper model in the future.
 *   - Cost is bounded: only fires on prompts that already triggered clarify
 *     (a small fraction after TM-52/TM-68 gates). ~$0.001-$0.003/call on
 *     Haiku / gpt-4o-mini.
 *
 * The shape returned matches `ClarifyResponse` exactly so downstream code
 * (route → reducer → PromptPanel ClarifyCard) is unchanged.
 */

import { chatComplete, getModels } from './client';
import type { ClarifyQuestion, ClarifyResponse } from '@/types';

/**
 * System prompt for the dedicated clarify-question generator.
 *
 * Design rules baked in:
 *   1. Strict JSON object output — `response_format: json_object` is forced
 *      on the OpenAI path by `chatCompleteStream`; the Anthropic path
 *      relies on this prompt + `extractJson`.
 *   2. 3-5 questions (not 1-3) so the UI surfaces a richer set; ClarifyCard
 *      already renders all of them and gates submit on all-answered.
 *   3. Each question is rooted in something *missing for this specific
 *      prompt*. Generic catch-alls ("데이터 종류?") are forbidden unless
 *      the prompt is genuinely about data.
 *   4. Multiple-choice only — 2-4 short labels. No free-text questions
 *      because the UI is choice-based.
 *   5. Language match: KO prompt → KO questions; EN prompt → EN questions.
 *   6. Few-shot examples cover diverse prompt categories so the model
 *      sees what "tailored" looks like across slideshow / logo / chart /
 *      text / particle / counter / transition surfaces.
 */
export const CLARIFY_QUESTION_GENERATOR_SYSTEM_PROMPT = `You are an expert assistant that produces SHORT, prompt-tailored clarifying questions for a generative-animation tool.

Your ONLY job: given a user's animation prompt that the upstream model judged ambiguous, produce 3 to 5 multiple-choice questions whose answers will let the next generation step produce a tailored asset.

OUTPUT — strict JSON object (no prose, no code fences):
{
  "questions": [
    {
      "id": "<short_snake_case_id>",
      "question": "<the question, in user's language>",
      "choices": [
        { "id": "<short_id>", "label": "<short option>" },
        { "id": "<short_id>", "label": "<short option>" }
      ]
    }
  ]
}

HARD RULES:
  1. Produce exactly 3, 4, or 5 questions. Never fewer than 3, never more than 5.
  2. Each question MUST be specific to what is genuinely missing from the user's prompt.
     Do NOT ask generic catch-alls ("데이터 종류?", "What kind of data?") UNLESS the prompt is actually about data.
  3. Each question is multiple-choice with 2-4 short labels (≤ ~6 words each).
  4. Use the user's input language. Korean prompt → Korean questions/choices. English prompt → English. Mixed → match the dominant language.
  5. Question ids: short snake_case, distinct across the set.
  6. Choice ids: short snake_case, distinct within each question.
  7. Cover diverse axes so the questions don't overlap. Pick from (use only those that genuinely apply to the prompt):
       - subject / kind (what exactly to render — only if subject is vague)
       - visual style / mood (캐주얼 / 럭셔리 / 미니멀 / 네온 / 레트로 / 시네마틱 ...)
       - palette / dominant color (warm / cool / monochrome / brand-color name ...)
       - pacing / duration (빠르게 / 천천히 / 3초 / 10초 ...)
       - text overlay (있음 / 없음 / 짧은 캡션 / 큰 헤드라인 ...)
       - background music mood (UI hint only, no audio rendered — but informs visual energy: 잔잔 / 신남 / 감성 / 강렬)
       - layout (전체화면 / 분할 / 세로 / 가로 ...)
       - data source/kind (only if data-driven)
       - transition style (only if multi-scene)
       - count / density (몇 개? — only if not specified)

EXAMPLES (do NOT copy these verbatim — they show the pattern of being prompt-specific):

Example A — prompt: "이미지 슬라이드쇼"
{
  "questions": [
    { "id": "style", "question": "전체적인 스타일은?",
      "choices": [
        {"id":"casual","label":"캐주얼"},
        {"id":"luxury","label":"럭셔리"},
        {"id":"minimal","label":"미니멀"},
        {"id":"cinematic","label":"시네마틱"}
      ] },
    { "id": "transition", "question": "이미지 간 전환 방식은?",
      "choices": [
        {"id":"fade","label":"페이드"},
        {"id":"slide","label":"슬라이드"},
        {"id":"zoom","label":"줌(켄번즈)"},
        {"id":"flip","label":"플립"}
      ] },
    { "id": "pacing", "question": "전환 속도는?",
      "choices": [
        {"id":"slow","label":"느리게(4초+)"},
        {"id":"medium","label":"보통(2-3초)"},
        {"id":"fast","label":"빠르게(<1.5초)"}
      ] },
    { "id": "text_overlay", "question": "텍스트 오버레이가 필요한가요?",
      "choices": [
        {"id":"none","label":"없음"},
        {"id":"caption","label":"짧은 캡션"},
        {"id":"title","label":"큰 헤드라인"}
      ] },
    { "id": "bgm_mood", "question": "배경 분위기 (BGM 느낌)는?",
      "choices": [
        {"id":"calm","label":"잔잔"},
        {"id":"upbeat","label":"신남"},
        {"id":"emotional","label":"감성"},
        {"id":"intense","label":"강렬"}
      ] }
  ]
}

Example B — prompt: "logo intro"
{
  "questions": [
    { "id": "reveal", "question": "How should the logo reveal?",
      "choices": [
        {"id":"fade_in","label":"Fade in"},
        {"id":"scale_pop","label":"Scale pop"},
        {"id":"draw_on","label":"Stroke draw-on"},
        {"id":"shatter","label":"Shatter / particles"}
      ] },
    { "id": "palette", "question": "Color palette?",
      "choices": [
        {"id":"mono","label":"Monochrome"},
        {"id":"warm","label":"Warm"},
        {"id":"cool","label":"Cool"},
        {"id":"neon","label":"Neon accent"}
      ] },
    { "id": "background", "question": "Background style?",
      "choices": [
        {"id":"solid","label":"Solid color"},
        {"id":"gradient","label":"Gradient"},
        {"id":"particles","label":"Particles"},
        {"id":"transparent","label":"Transparent"}
      ] },
    { "id": "duration", "question": "Length?",
      "choices": [
        {"id":"short","label":"~2s snappy"},
        {"id":"medium","label":"~4s standard"},
        {"id":"long","label":"~6s cinematic"}
      ] }
  ]
}

Example C — prompt: "차트 보여줘"
{
  "questions": [
    { "id": "chart_kind", "question": "차트 종류는?",
      "choices": [
        {"id":"bar","label":"막대"},
        {"id":"line","label":"라인"},
        {"id":"pie","label":"파이"},
        {"id":"donut","label":"도넛"}
      ] },
    { "id": "data_topic", "question": "데이터 주제는?",
      "choices": [
        {"id":"sales","label":"매출"},
        {"id":"users","label":"사용자"},
        {"id":"growth","label":"성장률"},
        {"id":"ranking","label":"순위"}
      ] },
    { "id": "palette", "question": "색감은?",
      "choices": [
        {"id":"corporate","label":"기업형(파랑)"},
        {"id":"warm","label":"따뜻한"},
        {"id":"vivid","label":"비비드"},
        {"id":"mono","label":"모노톤"}
      ] },
    { "id": "labels", "question": "수치 라벨 표시?",
      "choices": [
        {"id":"all","label":"모두"},
        {"id":"top","label":"최고/최저만"},
        {"id":"none","label":"없음"}
      ] }
  ]
}

REMEMBER: copy the *pattern* (prompt-specific, diverse axes, short choices) — never copy the example questions verbatim if the user's prompt is about something else.
`;

/**
 * TM-105 — runtime guard. The LLM occasionally returns malformed entries
 * (missing fields, empty choices, dupe ids). We coerce + validate and
 * surface a structured error if we cannot recover.
 */
export class ClarifyQuestionsValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = 'ClarifyQuestionsValidationError';
  }
}

/**
 * Validate and normalize raw LLM JSON into a `ClarifyResponse`.
 *
 * Drops malformed individual questions/choices rather than rejecting the
 * whole batch — as long as we end up with at least 3 valid questions, we
 * accept. Dedupes question + choice ids so the React keyed list stays
 * stable.
 */
export function normalizeClarifyResponse(raw: unknown): ClarifyResponse {
  if (!raw || typeof raw !== 'object') {
    throw new ClarifyQuestionsValidationError(
      'clarify-questions response was not an object',
      raw,
    );
  }
  const obj = raw as Record<string, unknown>;
  // Accept either {questions:[…]} or a bare array (defensive).
  const list = Array.isArray(obj.questions)
    ? obj.questions
    : Array.isArray(raw)
      ? raw
      : null;
  if (!list) {
    throw new ClarifyQuestionsValidationError(
      'clarify-questions response missing questions array',
      raw,
    );
  }

  const seenQ = new Set<string>();
  const out: ClarifyQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${out.length + 1}`;
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    if (!question) continue;
    const choicesRaw = Array.isArray(q.choices) ? q.choices : [];
    const seenC = new Set<string>();
    const choices = choicesRaw
      .map((c, idx) => {
        if (!c || typeof c !== 'object') return null;
        const co = c as Record<string, unknown>;
        const cid =
          typeof co.id === 'string' && co.id.trim() ? co.id.trim() : `c${idx + 1}`;
        const label = typeof co.label === 'string' ? co.label.trim() : '';
        if (!label) return null;
        if (seenC.has(cid)) return null;
        seenC.add(cid);
        return { id: cid, label };
      })
      .filter((c): c is { id: string; label: string } => c !== null);
    if (choices.length < 2) continue; // not multiple-choice
    let uniqueId = id;
    let suffix = 2;
    while (seenQ.has(uniqueId)) {
      uniqueId = `${id}_${suffix++}`;
    }
    seenQ.add(uniqueId);
    out.push({ id: uniqueId, question, choices });
  }

  if (out.length < 3) {
    throw new ClarifyQuestionsValidationError(
      `clarify-questions produced only ${out.length} valid question(s); need ≥3`,
      raw,
    );
  }
  // Cap at 5 to bound UI height.
  return { questions: out.slice(0, 5) };
}

/**
 * Strip code fences and parse the first balanced JSON object/array.
 * Mirrors the behavior of `extractJson` in `generate.ts`, but kept local
 * to avoid coupling the question generator to the asset generator's
 * private helpers (and to keep this module unit-testable in isolation).
 */
export function parseClarifyJson(text: string): unknown | null {
  const stripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  if (!stripped) return null;
  // Try direct parse first (json_object mode usually returns clean JSON).
  try {
    return JSON.parse(stripped);
  } catch {}
  // Fallback: find first balanced { ... }.
  const start = stripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface GenerateClarifyQuestionsOptions {
  /** Override the model used. Defaults to the active "free" model. */
  model?: string;
}

/**
 * TM-105 — produce 3-5 prompt-tailored clarifying questions.
 *
 * Throws on hard failures (no JSON, malformed, < 3 valid questions). The
 * caller (`generateAsset`) is expected to fall back to the original
 * questions returned by the primary call when this throws — never block
 * the user.
 */
export async function generateClarifyQuestions(
  userPrompt: string,
  options: GenerateClarifyQuestionsOptions = {},
): Promise<ClarifyResponse> {
  const model = options.model ?? getModels().free;
  const text = await chatComplete({
    model,
    system: CLARIFY_QUESTION_GENERATOR_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `User's animation prompt:\n${userPrompt}\n\nProduce 3-5 tailored clarifying questions in the JSON format described above. Match the user's language. Make every question reflect something genuinely missing for THIS prompt.`,
      },
    ],
  });

  const parsed = parseClarifyJson(text);
  if (!parsed) {
    throw new ClarifyQuestionsValidationError(
      'clarify-questions: could not parse JSON from LLM output',
      text,
    );
  }
  return normalizeClarifyResponse(parsed);
}
