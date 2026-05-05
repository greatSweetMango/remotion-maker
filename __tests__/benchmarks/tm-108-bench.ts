/**
 * TM-108 — Quality benchmark: baseline (single-shot) vs full (multi-step + RAG + ingest)
 *
 * 5 cases:
 *   1. baseline-simple   — short prompt, no special features
 *   2. long-video        — 60s duration hint (TM-104)
 *   3. url-ingest        — prompt + ATTACHED CONTEXT block (TM-103)
 *   4. multi-step-chart  — complex chart (TM-102 multi-step shines)
 *   5. multi-step-typo   — text-heavy composition
 *
 * Each case is generated once per mode (server-side AI_MULTI_STEP flag).
 * Mode is recorded in manifest; restart dev with the right env between modes.
 *
 * Capture: 2 frames (mid=90, end=180) via /studio?asset=...&frame=...
 * Judge: gpt-4o (TM-66 rubric, 4 axes 1-10).
 *
 * Outputs:
 *   __tests__/benchmarks/results/tm-108/<mode>/screenshots/<id>-<frame>.png
 *   __tests__/benchmarks/results/tm-108/<mode>/manifest.json
 *   __tests__/benchmarks/results/tm-108/<mode>/scores.json
 *
 * Usage:
 *   # baseline phase (dev server with AI_MULTI_STEP unset)
 *   TM108_MODE=baseline npx tsx __tests__/benchmarks/tm-108-bench.ts
 *   # full phase (dev server with AI_MULTI_STEP=1)
 *   TM108_MODE=full     npx tsx __tests__/benchmarks/tm-108-bench.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { openBrowser, ensureBrowser } from '@remotion/renderer';
import OpenAI from 'openai';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const PORT = process.env.PORT ?? '3108';
const HOST = process.env.HOSTNAME ?? '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const MODE = (process.env.TM108_MODE ?? 'baseline') as 'baseline' | 'full';
const ROOT_OUT = path.join(__dirname, 'results', 'tm-108', MODE);
const OUT_DIR = path.join(ROOT_OUT, 'screenshots');
const MANIFEST_PATH = path.join(ROOT_OUT, 'manifest.json');
const SCORES_PATH = path.join(ROOT_OUT, 'scores.json');
const FRAMES = [90, 180];

interface TM108Case {
  id: string;
  category: string;
  prompt: string;
  /** appended to user prompt verbatim (TM-103 simulated). */
  attachedContext?: string;
}

const ATTACHED_CONTEXT_HN = `

[ATTACHED CONTEXT]
source: https://news.ycombinator.com
title: Hacker News
description: Latest tech and startup news.
palette: ['#ff6600', '#f6f6ef', '#828282']
headlines:
  - "Show HN: A new way to ship products"
  - "Why we left the cloud"
  - "Ask HN: Best tools for indie hackers in 2026"
[/ATTACHED CONTEXT]`;

export const TM108_CASES: TM108Case[] = [
  {
    id: 'tm108-1-baseline-simple',
    category: 'baseline-simple',
    prompt: '심플한 로딩 스피너 8개 점, 파란색',
  },
  {
    id: 'tm108-2-long-video',
    category: 'long-video',
    prompt:
      '60초짜리 회사 소개 영상. 인트로(로고+태그라인) → 핵심 가치 3개 → CTA. 톤: 미니멀 + 진한 네이비.',
  },
  {
    id: 'tm108-3-url-ingest',
    category: 'url-ingest',
    prompt: 'Hacker News 스타일의 뉴스 헤드라인 카드 슬라이드쇼. 첨부 컨텍스트의 색감/문구 사용.',
    attachedContext: ATTACHED_CONTEXT_HN,
  },
  {
    id: 'tm108-4-multi-step-chart',
    category: 'multi-step-chart',
    prompt:
      '월별 매출 비교 인포그래픽. 1월 100, 2월 150, 3월 220, 4월 280, 5월 360, 6월 480 (단위: 백만원). 각 막대에 숫자 라벨, 좌측에 Y축 그리드, 상단에 "2026 H1 매출 성장" 타이틀, 우하단에 평균선. 컬러: 보라→핑크 그라디언트.',
  },
  {
    id: 'tm108-5-multi-step-typo',
    category: 'multi-step-typo',
    prompt:
      '키네틱 타이포그래피: "MOVE FAST. SHIP THINGS." 단어가 하나씩 커다랗게 들어왔다 나가고, 마지막에 두 줄이 겹쳐 정렬. 폰트: 굵은 산세리프. 배경: 검정. 강조 컬러: 형광 옐로.',
  },
];

interface CaptureItem {
  id: string;
  category: string;
  prompt: string;
  assetId?: string;
  framesCaptured: number[];
  generationMs?: number;
  error?: string;
}

async function login(): Promise<string> {
  const cookies = new Map<string, string>();
  let url: string | null = `${BASE}/api/dev/auto-login?callbackUrl=/studio`;
  for (let hop = 0; hop < 6 && url; hop++) {
    const cookieHdr = Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    const res: Response = await fetch(url, { headers: cookieHdr ? { cookie: cookieHdr } : {}, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      url = loc ? (loc.startsWith('http') ? loc : `${BASE}${loc.startsWith('/') ? '' : '/'}${loc}`) : null;
    } else {
      url = null;
    }
  }
  const cookie = Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  const sess = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } });
  const sj = (await sess.json()) as { user?: { email?: string } } | null;
  if (!sj?.user?.email) throw new Error(`login failed: session=${JSON.stringify(sj)}`);
  return cookie;
}

async function generate(prompt: string, cookie: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as {
    type: string;
    asset?: { id: string; durationInFrames: number; fps: number };
  };
  if (j.type !== 'generate' || !j.asset) throw new Error(`unexpected: ${JSON.stringify(j).slice(0, 200)}`);
  console.log(`  [gen ${Date.now() - t0}ms] ${j.asset.id} dur=${j.asset.durationInFrames}f`);
  return { asset: j.asset, ms: Date.now() - t0 };
}

async function captureFrame(opts: {
  browser: Awaited<ReturnType<typeof openBrowser>>;
  cookie: string;
  assetId: string;
  frame: number;
  outPath: string;
  pageIndex: number;
}) {
  const browserAny = opts.browser as unknown as {
    newPage: (a: {
      context: unknown; logLevel: string; indent: boolean; pageIndex: number;
      onBrowserLog: null; onLog: () => void;
    }) => Promise<{
      _client: () => { send: (m: string, p?: unknown) => Promise<unknown> };
      goto: (a: { url: string; timeout: number }) => Promise<unknown>;
      close: () => Promise<unknown>;
    }>;
  };
  const page = await browserAny.newPage({
    context: 'tm-108', logLevel: 'error', indent: false,
    pageIndex: opts.pageIndex, onBrowserLog: null, onLog: () => {},
  });
  try {
    const client = page._client();
    const cookies = opts.cookie.split('; ').map((kv) => {
      const eq = kv.indexOf('=');
      const name = kv.slice(0, eq);
      const value = kv.slice(eq + 1);
      return {
        name, value, domain: HOST, path: '/',
        httpOnly: name.includes('session-token'),
        secure: false, sameSite: 'Lax' as const,
      };
    });
    await client.send('Network.setCookies', { cookies });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    const url = `${BASE}/studio?asset=${opts.assetId}&frame=${opts.frame}`;
    await page.goto({ url, timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    const shotResp = (await client.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
    })) as { value?: { data: string }; data?: string };
    const data = shotResp.value?.data ?? shotResp.data;
    if (!data) throw new Error(`screenshot empty`);
    fs.writeFileSync(opts.outPath, Buffer.from(data, 'base64'));
  } finally {
    await page.close().catch(() => {});
  }
}

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'gpt-4o';
const SYSTEM_PROMPT = `너는 Remotion 으로 만든 모션 그래픽 산출물을 채점하는 시각 디자인 전문가다.
입력은 한 프롬프트에 대한 2개 프레임(중간/끝)이고, 각 프레임을 4축 1-10점으로 채점한다.

축 정의:
1. layout (레이아웃 균형): 배치/여백/시각 무게.
2. typography (타이포 가독성): 폰트 크기, 대비, 위계, 일관성.
3. motion (모션 자연스러움): 2 프레임 진행이 자연스러운지 (정지/회귀 감점).
4. fidelity (프롬프트 부합도): 원 프롬프트 키워드(주제/색상/숫자/길이) 반영.

반드시 아래 JSON 스키마로만 답하라:
{
  "frames": [
    {"frame": 90,  "layout": <1-10>, "typography": <1-10>, "motion": <1-10>, "fidelity": <1-10>, "comment": "<짧은 한국어>"},
    {"frame": 180, ...}
  ],
  "overall_comment": "<한국어 1-2 문장>",
  "improvement_suggestion": "<프롬프트/템플릿/렌더 개선안 1-2 문장>"
}`;

async function judge(client: OpenAI, item: CaptureItem, prompt: string) {
  const images: Array<{ frame: number; b64: string }> = [];
  for (const f of FRAMES) {
    const p = path.join(OUT_DIR, `${item.id}-${f}.png`);
    if (!fs.existsSync(p)) return null;
    images.push({ frame: f, b64: fs.readFileSync(p).toString('base64') });
  }
  const userContent = [
    { type: 'text' as const, text: `프롬프트(원문): "${prompt}"\n카테고리: ${item.category}\n첨부: 2 프레임 (90=중간, 180=끝). 위 루브릭에 따라 JSON 으로만 답해라.` },
    ...images.flatMap((img) => [
      { type: 'text' as const, text: `Frame ${img.frame}:` },
      { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${img.b64}` } },
    ]),
  ];
  const completion = await client.chat.completions.create({
    model: JUDGE_MODEL,
    max_tokens: 400,
    temperature: 0,
    seed: 42,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent as never },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? '';
  const j0 = text.indexOf('{'); const j1 = text.lastIndexOf('}');
  if (j0 < 0 || j1 < 0) return null;
  let parsed: { frames: { layout: number; typography: number; motion: number; fidelity: number }[]; overall_comment: string; improvement_suggestion: string };
  try { parsed = JSON.parse(text.slice(j0, j1 + 1)); } catch { return null; }
  const sums = parsed.frames.reduce(
    (a, f) => ({ layout: a.layout + f.layout, typography: a.typography + f.typography, motion: a.motion + f.motion, fidelity: a.fidelity + f.fidelity }),
    { layout: 0, typography: 0, motion: 0, fidelity: 0 },
  );
  const n = parsed.frames.length;
  const avgPerAxis = (sums.layout + sums.typography + sums.motion + sums.fidelity) / (4 * n);
  return {
    judge: parsed,
    overall_score: Math.round(avgPerAxis * 10),
    axis_avg: {
      layout: Math.round((sums.layout / n) * 10) / 10,
      typography: Math.round((sums.typography / n) * 10) / 10,
      motion: Math.round((sums.motion / n) * 10) / 10,
      fidelity: Math.round((sums.fidelity / n) * 10) / 10,
    },
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[TM-108] mode=${MODE} cases=${TM108_CASES.length}`);
  const cookie = await login();
  console.log(`[TM-108] login ok`);
  await ensureBrowser();
  const browser = await openBrowser('chrome', { headless: true } as never);

  const items: CaptureItem[] = [];
  let idx = 0;
  for (const c of TM108_CASES) {
    idx++;
    console.log(`\n[${idx}/${TM108_CASES.length}] ${c.id} (${c.category})`);
    const item: CaptureItem = { id: c.id, category: c.category, prompt: c.prompt, framesCaptured: [] };
    try {
      const userPrompt = c.prompt + (c.attachedContext ?? '');
      const { asset, ms } = await generate(userPrompt, cookie);
      item.assetId = asset.id;
      item.generationMs = ms;
      let pageIdx = 0;
      for (const f of FRAMES) {
        const targetFrame = Math.min(f, Math.max(0, asset.durationInFrames - 1));
        const outPath = path.join(OUT_DIR, `${c.id}-${f}.png`);
        try {
          await captureFrame({ browser, cookie, assetId: asset.id, frame: targetFrame, outPath, pageIndex: idx * 10 + pageIdx++ });
          item.framesCaptured.push(f);
          console.log(`    [cap] frame=${targetFrame}`);
        } catch (e) {
          console.log(`    [cap-fail] ${(e as Error).message}`);
        }
      }
    } catch (e) {
      item.error = (e as Error).message;
      console.log(`  [error] ${item.error}`);
    }
    items.push(item);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ mode: MODE, ran_at: new Date().toISOString(), items }, null, 2));
  }
  // @ts-expect-error
  await browser.close().catch(() => {});

  // Judge phase
  if (!process.env.OPENAI_API_KEY) {
    console.log(`[TM-108] OPENAI_API_KEY missing — skip judge`);
    return;
  }
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const scored: Array<{ id: string; category: string; overall_score: number; axis_avg: Record<string, number>; judge: unknown; generationMs?: number }> = [];
  for (const it of items) {
    if (it.framesCaptured.length < FRAMES.length) {
      console.log(`  [skip-judge] ${it.id} (frames=${it.framesCaptured.length})`);
      continue;
    }
    process.stdout.write(`  [judge] ${it.id} ... `);
    try {
      const r = await judge(oai, it, it.prompt);
      if (!r) { console.log('parse-fail'); continue; }
      scored.push({ id: it.id, category: it.category, overall_score: r.overall_score, axis_avg: r.axis_avg, judge: r.judge, generationMs: it.generationMs });
      console.log(`overall=${r.overall_score}  axes=${JSON.stringify(r.axis_avg)}`);
    } catch (e) {
      console.log(`error: ${(e as Error).message}`);
    }
  }
  const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.overall_score, 0) / scored.length) * 10) / 10 : 0;
  fs.writeFileSync(SCORES_PATH, JSON.stringify({ mode: MODE, ran_at: new Date().toISOString(), n: scored.length, avg_overall: avg, results: scored }, null, 2));
  console.log(`\n[done] mode=${MODE} avg=${avg}/100 wrote ${SCORES_PATH}`);
}

main().catch((e) => { console.error('[TM-108 FATAL]', e); process.exit(1); });
