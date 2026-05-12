/**
 * judge_visual / judge_code — LLM-as-judge core (TM-103).
 *
 * Standardises the visual-judge infra used by TM-46/TM-66 so other tasks
 * (TM-108/TM-111/...) can reuse the same rubric + determinism guarantees
 * via the MCP `mcp__llm-judge__judge_*` tools.
 *
 * Determinism: every call pins `temperature=0` + `seed=42` per ADR-0017
 * (capture) and ADR-0018 (judge). TM-70 RCA showed default-temperature
 * runs drift ±10 points on identical input — larger than the noise floor
 * we care about for acceptance gating.
 *
 * The judge model is configurable; defaults:
 *   judge_visual → gpt-4o      (multimodal)
 *   judge_code   → gpt-4o-mini (text only, cheaper)
 *
 * The OpenAI client is injected so callers (and tests) can substitute a
 * mock. The real MCP entrypoint constructs an `OpenAI` instance from
 * `OPENAI_API_KEY` once and shares it.
 */

export interface ChatLikeClient {
  chat: {
    completions: {
      create: (req: ChatRequest) => Promise<ChatResponse>;
    };
  };
}

export interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: unknown;
  }>;
  temperature?: number;
  seed?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

export interface ChatResponse {
  choices: Array<{ message: { content: string | null } }>;
}

/** Default rubric for `judge_visual`. 4 axes, 1-10 each. */
export const VISUAL_AXES = ['clarity', 'fidelity', 'aesthetic', 'intent_match'] as const;
export type VisualAxis = (typeof VISUAL_AXES)[number];

/** Default rubric for `judge_code`. 4 axes, 1-10 each. */
export const CODE_AXES = ['correctness', 'style', 'safety', 'intent_match'] as const;
export type CodeAxis = (typeof CODE_AXES)[number];

export interface VisualScores {
  clarity: number;
  fidelity: number;
  aesthetic: number;
  intent_match: number;
}

export interface CodeScores {
  correctness: number;
  style: number;
  safety: number;
  intent_match: number;
}

export interface JudgeResult<Scores> {
  scores: Scores;
  reasoning: string;
  raw_response: string;
  /** 0-100 derived from axis average (avg * 10). */
  overall: number;
  /** True if any axis < 6/10 — caller can use as gating signal. */
  needs_review: boolean;
}

export interface JudgeVisualInput {
  /** image as `data:image/png;base64,...` or `https://...` URL. */
  image_url: string;
  /** Optional extra criteria text appended to the system prompt. */
  criteria?: string;
  /** Defaults to gpt-4o. */
  model?: string;
}

export interface JudgeCodeInput {
  code: string;
  criteria?: string;
  /** Defaults to gpt-4o-mini. */
  model?: string;
}

const VISUAL_SYSTEM_PROMPT = `You are a visual design expert grading a generated image.
Score 1-10 on each of these 4 axes:
- clarity: visual clarity, legibility, focus
- fidelity: technical execution, rendering quality, no artifacts
- aesthetic: composition, color, balance, polish
- intent_match: how well the image matches the requested intent / criteria

Respond with JSON ONLY, exactly this shape, no other text:
{
  "scores": {"clarity": <1-10>, "fidelity": <1-10>, "aesthetic": <1-10>, "intent_match": <1-10>},
  "reasoning": "<1-3 short sentences>"
}`;

const CODE_SYSTEM_PROMPT = `You are a senior code reviewer grading a generated code snippet.
Score 1-10 on each of these 4 axes:
- correctness: does it actually work for its stated purpose
- style: idiomatic, readable, well-structured
- safety: free of dangerous patterns (eval/exec/network in sandboxes/etc.)
- intent_match: how well it satisfies the requested criteria

Respond with JSON ONLY, exactly this shape, no other text:
{
  "scores": {"correctness": <1-10>, "style": <1-10>, "safety": <1-10>, "intent_match": <1-10>},
  "reasoning": "<1-3 short sentences>"
}`;

function clamp1to10(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  // Treat NaN / non-numeric as the minimum (1). Returning 0 would break the
  // documented [1,10] axis range, and `needs_review` (<6) would still fire.
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(10, Math.round(v)));
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`no JSON object found in response: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export async function judgeVisual(
  client: ChatLikeClient,
  input: JudgeVisualInput,
): Promise<JudgeResult<VisualScores>> {
  if (!input || typeof input.image_url !== 'string' || input.image_url.length === 0) {
    throw new Error('judge_visual: image_url is required (data: URL or https URL)');
  }
  const model = input.model ?? 'gpt-4o';
  const system = input.criteria
    ? `${VISUAL_SYSTEM_PROMPT}\n\nExtra criteria from caller:\n${input.criteria}`
    : VISUAL_SYSTEM_PROMPT;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    seed: 42,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Grade this image per the rubric above.' },
          { type: 'image_url', image_url: { url: input.image_url } },
        ],
      },
    ],
  });

  const raw = resp.choices[0]?.message?.content ?? '';
  const parsed = extractJson(raw) as {
    scores?: Record<string, unknown>;
    reasoning?: string;
  };
  const s = parsed.scores ?? {};
  const scores: VisualScores = {
    clarity: clamp1to10(s.clarity),
    fidelity: clamp1to10(s.fidelity),
    aesthetic: clamp1to10(s.aesthetic),
    intent_match: clamp1to10(s.intent_match),
  };
  const arr = [scores.clarity, scores.fidelity, scores.aesthetic, scores.intent_match];
  const overall = Math.round(avg(arr) * 10);
  return {
    scores,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    raw_response: raw,
    overall,
    needs_review: arr.some((n) => n < 6),
  };
}

export async function judgeCode(
  client: ChatLikeClient,
  input: JudgeCodeInput,
): Promise<JudgeResult<CodeScores>> {
  if (!input || typeof input.code !== 'string' || input.code.length === 0) {
    throw new Error('judge_code: code is required (non-empty string)');
  }
  const model = input.model ?? 'gpt-4o-mini';
  const system = input.criteria
    ? `${CODE_SYSTEM_PROMPT}\n\nExtra criteria from caller:\n${input.criteria}`
    : CODE_SYSTEM_PROMPT;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    seed: 42,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Code to grade (fenced):\n\n\`\`\`\n${input.code}\n\`\`\``,
      },
    ],
  });

  const raw = resp.choices[0]?.message?.content ?? '';
  const parsed = extractJson(raw) as {
    scores?: Record<string, unknown>;
    reasoning?: string;
  };
  const s = parsed.scores ?? {};
  const scores: CodeScores = {
    correctness: clamp1to10(s.correctness),
    style: clamp1to10(s.style),
    safety: clamp1to10(s.safety),
    intent_match: clamp1to10(s.intent_match),
  };
  const arr = [scores.correctness, scores.style, scores.safety, scores.intent_match];
  const overall = Math.round(avg(arr) * 10);
  return {
    scores,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    raw_response: raw,
    overall,
    needs_review: arr.some((n) => n < 6),
  };
}
