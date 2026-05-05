/**
 * TM-102 r2 — Live verification of TM-111 sanitize + single-shot fallback fix.
 *
 * Replays the 5 prompts from TM-108 against `AI_MULTI_STEP=1 + gpt-4o`.
 * Records, per case:
 *   - HTTP status (200 vs 500)
 *   - multiStep.fallback ("single-shot" if sanitize couldn't save it)
 *   - warning string (TM-111 surfaces fallback to user)
 *   - generation latency
 *
 * No screenshot / no judge — gate is purely "200 response rate" + "fallback events".
 *
 * Usage:
 *   PORT=3102 HOSTNAME=127.0.0.1 npx tsx __tests__/benchmarks/tm-102-r2-verify.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.PORT ?? '3102';
const HOST = process.env.HOSTNAME ?? '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const OUT_DIR = path.join(__dirname, 'results', 'tm-102-r2');
const OUT_PATH = path.join(OUT_DIR, 'verify.json');

interface Case {
  id: string;
  category: string;
  prompt: string;
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

const CASES: Case[] = [
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
    prompt: 'Hacker News 스타일의 뉴스 헤드라인 카드 슬라이드쇼. 첨부 컨텍스트의 색감/문구 사용.' + ATTACHED_CONTEXT_HN,
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

interface Result {
  id: string;
  category: string;
  status: number;
  ok: boolean;
  ms: number;
  multiStep?: { costRatio?: number; fallback?: string };
  warning?: string;
  errorSnippet?: string;
  assetId?: string;
  durationFrames?: number;
}

async function runCase(c: Case, cookie: string): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ prompt: c.prompt }),
  });
  const ms = Date.now() - t0;
  const status = res.status;
  const text = await res.text();
  if (!res.ok) {
    return { id: c.id, category: c.category, status, ok: false, ms, errorSnippet: text.slice(0, 300) };
  }
  let j: {
    type?: string;
    asset?: { id: string; durationInFrames: number };
    multiStep?: { costRatio?: number; fallback?: string };
    warning?: string;
  };
  try {
    j = JSON.parse(text);
  } catch {
    return { id: c.id, category: c.category, status, ok: false, ms, errorSnippet: `parse-fail: ${text.slice(0, 200)}` };
  }
  return {
    id: c.id,
    category: c.category,
    status,
    ok: j.type === 'generate',
    ms,
    multiStep: j.multiStep,
    warning: j.warning,
    assetId: j.asset?.id,
    durationFrames: j.asset?.durationInFrames,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[TM-102-r2] cases=${CASES.length} base=${BASE}`);
  const cookie = await login();
  console.log(`[TM-102-r2] login ok`);
  const results: Result[] = [];
  for (const c of CASES) {
    process.stdout.write(`[${c.id}] ... `);
    try {
      const r = await runCase(c, cookie);
      results.push(r);
      const fb = r.multiStep?.fallback ? ` fallback=${r.multiStep.fallback}` : '';
      const errStub = r.errorSnippet ? ` err="${r.errorSnippet.slice(0, 80)}"` : '';
      console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.status} ${r.ms}ms${fb}${errStub}`);
    } catch (e) {
      const r: Result = { id: c.id, category: c.category, status: 0, ok: false, ms: 0, errorSnippet: String(e).slice(0, 200) };
      results.push(r);
      console.log(`THROW ${r.errorSnippet}`);
    }
  }
  const passCount = results.filter((r) => r.ok).length;
  const fallbackCount = results.filter((r) => r.multiStep?.fallback === 'single-shot').length;
  const summary = {
    runAt: new Date().toISOString(),
    flags: { AI_MULTI_STEP: process.env.AI_MULTI_STEP, AI_PROVIDER: process.env.AI_PROVIDER },
    totalCases: CASES.length,
    passCount,
    failCount: CASES.length - passCount,
    fallbackCount,
    passRate: passCount / CASES.length,
    results,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\n[TM-102-r2] pass=${passCount}/${CASES.length} fallback=${fallbackCount} → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
