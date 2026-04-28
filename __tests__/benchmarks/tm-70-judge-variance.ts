/**
 * TM-70 — Visual judge variance experiment.
 *
 * Runs the EXISTING tm-46 judge prompt against the SAME (prompt, 3-frame PNG triple)
 * input N times under two conditions:
 *
 *   A. temperature unspecified (current default = 1.0, no seed)  — reproduces r3/r4 setup.
 *   B. temperature=0, seed=42                                    — proposed fix.
 *
 * Output: __tests__/benchmarks/results/tm-70/variance.json
 *   { sample_id: { A: [scores], B: [scores], A_mean, A_std, B_mean, B_std } }
 *
 * Goal: quantify judge non-determinism. If A_std ≥ 10 we have strong evidence
 * that the r3→r4 -7.8 regression can be explained by judge variance alone.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'gpt-4o';
const N_REPEATS = Number(process.env.TM70_N ?? 3);

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

interface Sample {
  id: string;
  category: string;
  prompt: string;
  /** 3 PNG paths (start/mid/end) */
  frames: [string, string, string];
}

const TM43_DIR = path.join(
  __dirname,
  '..',
  '..',
  'wiki',
  '05-reports',
  'screenshots',
  'TM-43',
);

function trio(slug: string): [string, string, string] {
  return [
    path.join(TM43_DIR, `${slug}-start.png`),
    path.join(TM43_DIR, `${slug}-mid.png`),
    path.join(TM43_DIR, `${slug}-end.png`),
  ];
}

/**
 * 5 stable samples, mapped to TM-46 categories using TM-43 templates as proxies.
 * The point isn't perfect prompt fidelity — it's that the judge sees the EXACT
 * same input bytes every call, so any score variance is judge-side only.
 */
const SAMPLES: Sample[] = [
  {
    id: 'tr-10-proxy',
    category: 'transition',
    prompt: 'Morph transition from circle to square, single accent color (#FF6B6B)',
    frames: trio('zoom-transition'),
  },
  {
    id: 'ig-01-proxy',
    category: 'infographic',
    prompt: 'Step indicator 1-2-3-4 with checkmarks animating in, green accent',
    frames: trio('timeline'),
  },
  {
    id: 'dv-06-proxy',
    category: 'data-viz',
    prompt:
      'Animated percentage ring filling from 0% to 75%, neon cyan color, dark background',
    frames: trio('progress-circle'),
  },
  {
    id: 'ta-02-proxy',
    category: 'text-anim',
    prompt: '"Hello World" 가 한 글자씩 타이핑되며 등장',
    frames: trio('typewriter'),
  },
  {
    id: 'ld-01-proxy',
    category: 'loader',
    prompt: 'Circular spinner loader, 8 dots rotating, primary blue color',
    frames: trio('circle-pulse'),
  },
];

function toBase64(p: string): string {
  return fs.readFileSync(p).toString('base64');
}

interface FrameScore {
  frame: number;
  layout: number;
  typography: number;
  motion: number;
  fidelity: number;
}
interface JudgeOut {
  frames: FrameScore[];
  overall_comment?: string;
  improvement_suggestion?: string;
}

async function judgeOnce(
  client: OpenAI,
  s: Sample,
  opts: { temperature?: number; seed?: number },
): Promise<{ overall: number; perAxis: Record<string, number> } | null> {
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: `프롬프트(원문): "${s.prompt}"\n카테고리: ${s.category}\n첨부: 3 프레임 (60=1초, 90=중간, 180=끝). 위 루브릭에 따라 JSON 으로만 답해라.`,
    },
  ];
  const labels = [60, 90, 180];
  s.frames.forEach((p, i) => {
    userContent.push({ type: 'text', text: `Frame ${labels[i]}:` });
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${toBase64(p)}` },
    });
  });

  const req: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: JUDGE_MODEL,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  };
  if (opts.temperature !== undefined) req.temperature = opts.temperature;
  if (opts.seed !== undefined) req.seed = opts.seed;

  const completion = await client.chat.completions.create(req);
  const text = completion.choices[0]?.message?.content ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  let judge: JudgeOut;
  try {
    judge = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!judge.frames || judge.frames.length === 0) return null;
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
  const overall = Math.round(
    ((sums.layout + sums.typography + sums.motion + sums.fidelity) / (4 * n)) * 10,
  );
  return {
    overall,
    perAxis: {
      layout: +(sums.layout / n).toFixed(2),
      typography: +(sums.typography / n).toFixed(2),
      motion: +(sums.motion / n).toFixed(2),
      fidelity: +(sums.fidelity / n).toFixed(2),
    },
  };
}

function stat(arr: number[]): { mean: number; std: number; min: number; max: number } {
  if (arr.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance =
    arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return {
    mean: +mean.toFixed(2),
    std: +Math.sqrt(variance).toFixed(2),
    min: Math.min(...arr),
    max: Math.max(...arr),
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

  // Sanity-check sample PNGs exist.
  for (const s of SAMPLES) {
    for (const f of s.frames) {
      if (!fs.existsSync(f)) throw new Error(`missing fixture: ${f}`);
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(
    `[tm-70-variance] model=${JUDGE_MODEL} samples=${SAMPLES.length} repeats=${N_REPEATS}`,
  );

  type RunRecord = {
    overall: number;
    layout: number;
    typography: number;
    motion: number;
    fidelity: number;
  };
  const data: Record<
    string,
    {
      sample: Sample;
      A: RunRecord[];
      B: RunRecord[];
    }
  > = {};

  for (const s of SAMPLES) {
    data[s.id] = { sample: s, A: [], B: [] };

    for (let i = 0; i < N_REPEATS; i++) {
      process.stdout.write(`  ${s.id} A#${i + 1} (default temp) ... `);
      const r = await judgeOnce(client, s, {});
      if (r) {
        data[s.id].A.push({
          overall: r.overall,
          layout: r.perAxis.layout,
          typography: r.perAxis.typography,
          motion: r.perAxis.motion,
          fidelity: r.perAxis.fidelity,
        });
        console.log(`overall=${r.overall}`);
      } else {
        console.log('skip');
      }
    }
    for (let i = 0; i < N_REPEATS; i++) {
      process.stdout.write(`  ${s.id} B#${i + 1} (temp=0,seed=42) ... `);
      const r = await judgeOnce(client, s, { temperature: 0, seed: 42 });
      if (r) {
        data[s.id].B.push({
          overall: r.overall,
          layout: r.perAxis.layout,
          typography: r.perAxis.typography,
          motion: r.perAxis.motion,
          fidelity: r.perAxis.fidelity,
        });
        console.log(`overall=${r.overall}`);
      } else {
        console.log('skip');
      }
    }
  }

  // Summarize.
  const summary: Record<string, unknown> = {};
  let aggA: number[] = [];
  let aggB: number[] = [];
  for (const id of Object.keys(data)) {
    const aOverall = data[id].A.map((r) => r.overall);
    const bOverall = data[id].B.map((r) => r.overall);
    aggA = aggA.concat(aOverall);
    aggB = aggB.concat(bOverall);
    summary[id] = {
      category: data[id].sample.category,
      prompt: data[id].sample.prompt,
      A_default_temp: { runs: aOverall, ...stat(aOverall) },
      B_temp0_seed42: { runs: bOverall, ...stat(bOverall) },
      delta_max: aOverall.length ? Math.max(...aOverall) - Math.min(...aOverall) : 0,
    };
  }

  const aggregate = {
    A_default_temp: stat(aggA),
    B_temp0_seed42: stat(aggB),
    A_mean_pairwise_delta_max:
      Object.values(summary)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((s: any) => s.delta_max)
        .reduce((a, b) => a + b, 0) / SAMPLES.length,
  };

  const outDir = path.join(__dirname, 'results', 'tm-70');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'variance.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        model: JUDGE_MODEL,
        ran_at: new Date().toISOString(),
        n_repeats: N_REPEATS,
        samples: summary,
        aggregate,
      },
      null,
      2,
    ),
  );
  console.log(`\n[done] wrote ${outPath}`);
  console.log(JSON.stringify(aggregate, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
