/**
 * TM-46 — Visual LLM-as-judge (TM-66: OpenAI gpt-4o multimodal).
 *
 * 입력: 30 프롬프트 × 3 프레임 PNG (총 90 screenshots).
 *   각 PNG path: __tests__/benchmarks/results/tm-46/screenshots/<id>-<frame>.png
 *
 * 처리: 프롬프트 단위로 3 프레임을 묶어 OpenAI gpt-4o 에 multimodal 요청.
 *      4축 (layout/typography/motion/fidelity) × 3 프레임 = 12 점수 + comment.
 *
 * TM-111 마이그레이션 (이번 회차):
 *  - judge 호출부를 plugin/llm-judge (TM-103 MCP) 와 같은 결정성 컨트랙트로
 *    정렬: `ChatLikeClient` 인터페이스 채택 → 단위 테스트가 OpenAI SDK 없이도
 *    judge 로직만 mock 으로 검증 가능.
 *  - ADR-0018 N≥2 variance probe 내장: 동일 입력을 `N_SHOTS` 회 (기본 2,
 *    env `TM111_N_SHOTS` 로 override) 호출하여 `runs[]`, `delta_max`, `std`
 *    필드를 sample 단위로 emit. judge-acceptance skill (TM-100) Step 4
 *    acceptance gate 가 noise 큰 sample 을 구별할 수 있도록 surface.
 *  - 출력 JSON envelope 에 `n_shots`, `seed`, `temperature` 메타데이터 포함
 *    → 회차 간 비교 시 결정성 가드가 동일했는지 검증 가능.
 *
 * TM-66 마이그레이션 (이전 회차): ANTHROPIC_API_KEY 가비 로 인한 escalate.
 * judge 를 OpenAI gpt-4o (멀티모달 + JSON mode) 로 전환. 4축 루브릭/스키마는
 * 동일. 비용 비교: Opus 4.7 ~ $0.06/req → gpt-4o ~ $0.05/req.
 *
 * 사용:
 *   OPENAI_API_KEY=... npx tsx __tests__/benchmarks/tm-46-judge.ts \
 *     --screenshots-dir __tests__/benchmarks/results/tm-46/screenshots \
 *     [--smoke] [--out <path>] [--n-shots 2]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

// TM-66: load .env.local from worktree root so OPENAI_API_KEY propagates
// even when the parent shell sandbox strips API keys from child processes.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });
import {
  TM46_PROMPTS,
  TM46_SMOKE_PROMPTS,
  CAPTURE_FRAMES,
} from './tm-46-prompts';
import type { BenchmarkPrompt } from './params-extraction.benchmark';

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'gpt-4o';
// TM-111: ADR-0018 variance probe. N=2 default per task spec (cheap floor
// — full 30-prompt run doubles cost ~$1 → ~$2). Override via env for the
// canonical N≥3 acceptance gate run (judge-acceptance skill Step 2/3).
const N_SHOTS_DEFAULT = Number(process.env.TM111_N_SHOTS ?? '2');
const JUDGE_SEED = 42;
const JUDGE_TEMPERATURE = 0;

/**
 * Minimal chat-completions surface used by the visual judge. Matches the
 * shape of `ChatLikeClient` in `plugin/llm-judge/src/judge.ts` (TM-103 MCP)
 * so the same mock pattern works for both code paths. The real OpenAI SDK
 * client satisfies this shape via a structural cast (see `main()`).
 */
export interface ChatLikeClient {
  chat: {
    completions: {
      create: (
        req: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      ) => Promise<{ choices: Array<{ message: { content: string | null } }> }>;
    };
  };
}

const SYSTEM_PROMPT = `너는 Remotion 으로 만든 모션 그래픽 산출물을 채점하는 시각 디자인 전문가다.
입력은 한 프롬프트에 대한 3개 프레임(1초/중간/끝)이고, 각 프레임을 4축 1-10점으로 채점한다.

축 정의:
1. layout (레이아웃 균형): 배치/여백/시각 무게.
2. typography (타이포 가독성): 폰트 크기, 대비, 위계, 일관성.
3. motion (모션 자연스러움): 3 프레임 진행이 자연스러운지 (정지/회귀 감점).
4. fidelity (프롬프트 부합도): 원 프롬프트 키워드(주제/색상/숫자) 반영.

반드시 아래 JSON 스키마로만 답하라. 다른 텍스트 금지:
{
  "frames": [
    {"frame": 60, "layout": <1-10>, "typography": <1-10>, "motion": <1-10>, "fidelity": <1-10>, "comment": "<짧은 한국어>"},
    {"frame": 90, ...},
    {"frame": 180, ...}
  ],
  "overall_comment": "<한국어 1-2 문장>",
  "improvement_suggestion": "<프롬프트/템플릿/렌더 개선안 1-2 문장>"
}`;

interface FrameScore {
  frame: number;
  layout: number;
  typography: number;
  motion: number;
  fidelity: number;
  comment: string;
}

interface JudgeResult {
  frames: FrameScore[];
  overall_comment: string;
  improvement_suggestion: string;
}

interface PromptScore {
  id: string;
  category: string;
  prompt: string;
  /** Last successful judge response (full per-frame breakdown + comments). */
  judge: JudgeResult;
  /** 0-100 환산. 3프레임 4축 평균 * 2.5 — mean of runs[]. */
  overall_score: number;
  /** follow-up task spawn 대상이면 true (mean overall_score < 70). */
  needs_followup: boolean;
  /** TM-111 / ADR-0018: per-shot overall scores (0-100), length == n_shots. */
  runs: number[];
  /** max - min over runs[]. judge-acceptance gate floor = 3 (ADR-0018). */
  delta_max: number;
  /** Standard deviation over runs[]. */
  std: number;
  /** Number of successful shots used to compute runs[]. */
  n_shots: number;
}

function loadScreenshot(dir: string, id: string, frame: number): string | null {
  const candidates = [
    path.join(dir, `${id}-${frame}.png`),
    path.join(dir, `${id}/${frame}.png`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function toBase64(p: string): string {
  return fs.readFileSync(p).toString('base64');
}

/** Single deterministic judge call. Returns null on parse failure. */
async function judgeOnce(
  client: ChatLikeClient,
  prompt: BenchmarkPrompt,
  images: Array<{ frame: number; b64: string }>,
): Promise<{ judge: JudgeResult; overall: number } | null> {
  // OpenAI multimodal: image_url with data: URL. interleave text/image to label frames.
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: `프롬프트(원문): "${prompt.prompt}"
카테고리: ${prompt.category}
첨부: 3 프레임 (60=1초, 90=중간, 180=끝). 위 루브릭에 따라 JSON 으로만 답해라.`,
    },
    ...images.flatMap<OpenAI.Chat.Completions.ChatCompletionContentPart>(
      ({ frame, b64 }) => [
        { type: 'text' as const, text: `Frame ${frame}:` },
        {
          type: 'image_url' as const,
          image_url: { url: `data:image/png;base64,${b64}` },
        },
      ],
    ),
  ];

  // TM-70 / ADR-0018: pin temperature=0 + seed for judge determinism.
  // Variance experiment (`__tests__/benchmarks/tm-70-judge-variance.ts`)
  // showed default-temperature (=1.0) calls drift ±10 points on identical
  // input — larger than the r3→r4 -7.8 "regression". TM-111 layers a
  // mandatory N-shot probe on top of this guarantee.
  const completion = await client.chat.completions.create({
    model: JUDGE_MODEL,
    max_tokens: 400,
    temperature: JUDGE_TEMPERATURE,
    seed: JUDGE_SEED,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? '';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) {
    console.error(`  [parse-fail] ${prompt.id}: ${text.slice(0, 120)}`);
    return null;
  }
  let judge: JudgeResult;
  try {
    judge = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    console.error(`  [parse-fail] ${prompt.id}: ${(e as Error).message}`);
    return null;
  }
  if (!Array.isArray(judge.frames) || judge.frames.length === 0) {
    console.error(`  [parse-fail] ${prompt.id}: frames[] empty/missing`);
    return null;
  }

  const sums = judge.frames.reduce(
    (acc, f) => ({
      layout: acc.layout + (f.layout ?? 0),
      typography: acc.typography + (f.typography ?? 0),
      motion: acc.motion + (f.motion ?? 0),
      fidelity: acc.fidelity + (f.fidelity ?? 0),
    }),
    { layout: 0, typography: 0, motion: 0, fidelity: 0 },
  );
  const n = judge.frames.length;
  const avgPerAxis =
    (sums.layout + sums.typography + sums.motion + sums.fidelity) / (4 * n);
  const overall = Math.round(avgPerAxis * 10); // 1-10 → 0-100
  return { judge, overall };
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance =
    arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return +Math.sqrt(variance).toFixed(2);
}

/**
 * Multi-shot variance probe (TM-111 / ADR-0018).
 *
 * Calls the judge `n_shots` times against the same input. Aggregates
 * per-shot `overall` scores into `runs[]`, derives `delta_max` and `std`
 * so the judge-acceptance gate (skill TM-100, Step 4) can flag noisy
 * samples even when the mean is above its axis floor.
 *
 * Notes:
 *  - With deterministic flags (temp=0, seed=42) we expect Δmax ≤ 3 by
 *    ADR-0018 floor. Anything larger is a regression signal.
 *  - `overall_score` is the **mean** of successful runs (rounded), so the
 *    follow-up gate (<70) is computed against the aggregate, not a single
 *    flaky shot.
 *  - The returned `judge` field holds the last successful per-frame
 *    breakdown — sufficient for the retro "needs_followup" snippet.
 */
export async function judgePrompt(
  client: ChatLikeClient,
  prompt: BenchmarkPrompt,
  screenshotsDir: string,
  opts: { nShots?: number } = {},
): Promise<PromptScore | null> {
  const nShots = Math.max(1, opts.nShots ?? N_SHOTS_DEFAULT);
  const images: Array<{ frame: number; b64: string }> = [];
  for (const frame of CAPTURE_FRAMES) {
    const p = loadScreenshot(screenshotsDir, prompt.id, frame);
    if (!p) {
      console.warn(`  [skip] missing screenshot ${prompt.id}-${frame}.png`);
      return null;
    }
    images.push({ frame, b64: toBase64(p) });
  }

  const runs: number[] = [];
  let lastJudge: JudgeResult | null = null;
  for (let i = 0; i < nShots; i++) {
    const r = await judgeOnce(client, prompt, images);
    if (r) {
      runs.push(r.overall);
      lastJudge = r.judge;
    }
  }
  if (runs.length === 0 || lastJudge === null) return null;

  const mean = Math.round(runs.reduce((s, v) => s + v, 0) / runs.length);
  const deltaMax = runs.length > 1 ? Math.max(...runs) - Math.min(...runs) : 0;

  return {
    id: prompt.id,
    category: prompt.category,
    prompt: prompt.prompt,
    judge: lastJudge,
    overall_score: mean,
    needs_followup: mean < 70,
    runs,
    delta_max: deltaMax,
    std: std(runs),
    n_shots: runs.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const dirIdx = args.indexOf('--screenshots-dir');
  const screenshotsDir =
    dirIdx >= 0
      ? args[dirIdx + 1]
      : path.join(__dirname, 'results', 'tm-46', 'screenshots');
  const nShotsIdx = args.indexOf('--n-shots');
  const nShots =
    nShotsIdx >= 0 ? Math.max(1, Number(args[nShotsIdx + 1])) : N_SHOTS_DEFAULT;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required');
  }
  if (!fs.existsSync(screenshotsDir)) {
    throw new Error(`screenshots dir missing: ${screenshotsDir}`);
  }

  // TM-111: structural cast — the real OpenAI SDK satisfies ChatLikeClient.
  // Same pattern as plugin/llm-judge/src/server.ts so tests can substitute
  // a hermetic mock without pulling the SDK.
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }) as unknown as ChatLikeClient;
  const prompts = smoke ? TM46_SMOKE_PROMPTS : TM46_PROMPTS;
  console.log(
    `[tm-46-judge] mode=${smoke ? 'smoke' : 'full'} n=${prompts.length} model=${JUDGE_MODEL} n_shots=${nShots} seed=${JUDGE_SEED} temp=${JUDGE_TEMPERATURE}`,
  );

  const results: PromptScore[] = [];
  for (const p of prompts) {
    process.stdout.write(`  ${p.id} [${p.category}] ... `);
    try {
      const r = await judgePrompt(client, p, screenshotsDir, { nShots });
      if (r) {
        results.push(r);
        const varTag =
          r.n_shots > 1 ? ` runs=[${r.runs.join(',')}] Δ=${r.delta_max} σ=${r.std}` : '';
        console.log(
          `overall=${r.overall_score}${varTag}${r.needs_followup ? ' ⚠ FOLLOWUP' : ''}`,
        );
      } else {
        console.log('skip');
      }
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
    }
  }

  // TM-46 r7: allow overriding output path so RAG-ON / RAG-OFF runs can be
  // judged into separate score files without collision.
  const outIdx = args.indexOf('--out');
  const outPathArg = outIdx >= 0 ? args[outIdx + 1] : null;
  const outDir = outPathArg ? path.dirname(outPathArg) : path.join(__dirname, 'results', 'tm-46');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = outPathArg ?? path.join(outDir, smoke ? 'scores-smoke.json' : 'scores.json');
  // TM-111: aggregate variance across all samples for ADR-0018 health check.
  // delta_max_mean > 3 → judge determinism degraded; block downstream gate.
  const deltaMaxes = results.map((r) => r.delta_max);
  const avgDeltaMax =
    deltaMaxes.length > 0
      ? +(deltaMaxes.reduce((s, v) => s + v, 0) / deltaMaxes.length).toFixed(2)
      : 0;
  const maxDeltaMax = deltaMaxes.length > 0 ? Math.max(...deltaMaxes) : 0;

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        model: JUDGE_MODEL,
        ran_at: new Date().toISOString(),
        n: results.length,
        // ADR-0018 determinism envelope — judge-acceptance skill Step 2
        // verifies these match the floor before scoring is considered valid.
        n_shots: nShots,
        seed: JUDGE_SEED,
        temperature: JUDGE_TEMPERATURE,
        avg_overall:
          results.length > 0
            ? Math.round(
                (results.reduce((s, r) => s + r.overall_score, 0) / results.length) * 10,
              ) / 10
            : 0,
        variance: {
          avg_delta_max: avgDeltaMax,
          max_delta_max: maxDeltaMax,
          // ADR-0018 floor (mean Δmax ≤ 3 at temp=0/seed=42).
          floor_violated: avgDeltaMax > 3,
        },
        followup_count: results.filter((r) => r.needs_followup).length,
        results,
      },
      null,
      2,
    ),
  );

  console.log(`\n[done] wrote ${outPath}`);
  console.log(
    `  avg=${
      results.length > 0
        ? Math.round((results.reduce((s, r) => s + r.overall_score, 0) / results.length) * 10) /
          10
        : 0
    }  followup=${results.filter((r) => r.needs_followup).length}/${results.length}`,
  );

  // Print follow-up spawn commands.
  const followups = results.filter((r) => r.needs_followup);
  if (followups.length > 0) {
    console.log(`\n[followup task spawn commands]`);
    for (const f of followups) {
      const slug = f.id.replace(/[^a-z0-9-]/g, '-');
      const title = `AI-IMPROVE-${f.category}-${slug}`;
      const desc = `${f.prompt} — judge ${f.overall_score}/100. ${f.judge.improvement_suggestion}`;
      console.log(
        `task-master add-task -t "${title}" -d ${JSON.stringify(desc)} --details ${JSON.stringify(
          `metadata: {"triggers_requalify":["46"],"qa_iteration":1}`,
        )} --priority medium --dependencies "46"`,
      );
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
