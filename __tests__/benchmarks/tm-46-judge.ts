/**
 * TM-46 — Visual LLM-as-judge.
 *
 * 입력: 30 프롬프트 × 3 프레임 PNG (총 90 screenshots).
 *   각 PNG path: __tests__/benchmarks/results/tm-46/screenshots/<id>-<frame>.png
 *
 * 처리: 프롬프트 단위로 3 프레임을 묶어 Claude Opus 4.7 에 multimodal 1회 요청.
 *      4축 (layout/typography/motion/fidelity) × 3 프레임 = 12 점수 + comment.
 *
 * 출력: __tests__/benchmarks/results/tm-46/scores.json
 *      각 프롬프트 평균 + <70 케이스 follow-up task spawn 권장 목록.
 *
 * 사용:
 *   ANTHROPIC_API_KEY=... npx tsx __tests__/benchmarks/tm-46-judge.ts \
 *     --screenshots-dir __tests__/benchmarks/results/tm-46/screenshots \
 *     [--smoke]
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  TM46_PROMPTS,
  TM46_SMOKE_PROMPTS,
  CAPTURE_FRAMES,
} from './tm-46-prompts';
import type { BenchmarkPrompt } from './params-extraction.benchmark';

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'claude-opus-4-7-20260101';

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
  judge: JudgeResult;
  /** 0-100 환산. 3프레임 4축 평균 * 2.5 */
  overall_score: number;
  /** follow-up task spawn 대상이면 true */
  needs_followup: boolean;
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

async function judgePrompt(
  client: Anthropic,
  prompt: BenchmarkPrompt,
  screenshotsDir: string,
): Promise<PromptScore | null> {
  const images: Array<{ frame: number; b64: string }> = [];
  for (const frame of CAPTURE_FRAMES) {
    const p = loadScreenshot(screenshotsDir, prompt.id, frame);
    if (!p) {
      console.warn(`  [skip] missing screenshot ${prompt.id}-${frame}.png`);
      return null;
    }
    images.push({ frame, b64: toBase64(p) });
  }

  const userContent: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: 'text',
      text: `프롬프트(원문): "${prompt.prompt}"
카테고리: ${prompt.category}
첨부: 3 프레임 (60=1초, 90=중간, 180=끝). 위 루브릭에 따라 JSON 으로만 답해라.`,
    },
    ...images.flatMap<Anthropic.Messages.ContentBlockParam>(({ frame, b64 }) => [
      { type: 'text', text: `Frame ${frame}:` },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: b64 },
      },
    ]),
  ];

  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
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

  const sums = judge.frames.reduce(
    (acc, f) => ({
      layout: acc.layout + f.layout,
      typography: acc.typography + f.typography,
      motion: acc.motion + f.motion,
      fidelity: acc.fidelity + f.fidelity,
    }),
    { layout: 0, typography: 0, motion: 0, fidelity: 0 },
  );
  const n = judge.frames.length;
  const avgPerAxis =
    (sums.layout + sums.typography + sums.motion + sums.fidelity) / (4 * n);
  const overall = Math.round(avgPerAxis * 10); // 1-10 → 0-100

  return {
    id: prompt.id,
    category: prompt.category,
    prompt: prompt.prompt,
    judge,
    overall_score: overall,
    needs_followup: overall < 70,
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

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY required');
  }
  if (!fs.existsSync(screenshotsDir)) {
    throw new Error(`screenshots dir missing: ${screenshotsDir}`);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompts = smoke ? TM46_SMOKE_PROMPTS : TM46_PROMPTS;
  console.log(`[tm-46-judge] mode=${smoke ? 'smoke' : 'full'} n=${prompts.length} model=${JUDGE_MODEL}`);

  const results: PromptScore[] = [];
  for (const p of prompts) {
    process.stdout.write(`  ${p.id} [${p.category}] ... `);
    try {
      const r = await judgePrompt(client, p, screenshotsDir);
      if (r) {
        results.push(r);
        console.log(`overall=${r.overall_score}${r.needs_followup ? ' ⚠ FOLLOWUP' : ''}`);
      } else {
        console.log('skip');
      }
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
    }
  }

  const outDir = path.join(__dirname, 'results', 'tm-46');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, smoke ? 'scores-smoke.json' : 'scores.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        model: JUDGE_MODEL,
        ran_at: new Date().toISOString(),
        n: results.length,
        avg_overall:
          results.length > 0
            ? Math.round(
                (results.reduce((s, r) => s + r.overall_score, 0) / results.length) * 10,
              ) / 10
            : 0,
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
