/**
 * TM-114 — Validation: run the 5 TM-108 prompts through multi-step
 * pipeline and confirm none produce a `const ... = undefined;` artefact
 * that triggered the studio ErrorBoundary. Also factory-eval each jsCode
 * end-to-end in Node and assert no destructure-of-undefined throws.
 *
 * Run:  AI_MULTI_STEP=1 npx tsx __tests__/benchmarks/tm-114-validate.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { generateAssetMultiStep } from '../../src/lib/ai/pipeline';

const ATTACHED_CONTEXT_HN = `

[ATTACHED CONTEXT]
source: https://news.ycombinator.com
title: Hacker News
description: Latest tech and startup news.
headlines:
  - "Show HN: A new way to ship products"
  - "Why we left the cloud"
  - "Ask HN: Best tools for indie hackers in 2026"
[/ATTACHED CONTEXT]`;

const CASES = [
  { id: 'tm108-1-baseline-simple', prompt: '심플한 로딩 스피너 8개 점, 파란색' },
  { id: 'tm108-2-long-video', prompt: '60초짜리 회사 소개 영상. 인트로(로고+태그라인) → 핵심 가치 3개 → CTA. 톤: 미니멀 + 진한 네이비.' },
  { id: 'tm108-3-url-ingest', prompt: 'Hacker News 스타일의 뉴스 헤드라인 카드 슬라이드쇼. 첨부 컨텍스트의 색감/문구 사용.' + ATTACHED_CONTEXT_HN },
  { id: 'tm108-4-multi-step-chart', prompt: '월별 매출 비교 인포그래픽. 1월 100, 2월 150, 3월 220, 4월 280, 5월 360, 6월 480 (단위: 백만원). 각 막대에 숫자 라벨, 좌측에 Y축 그리드, 상단에 "2026 H1 매출 성장" 타이틀, 우하단에 평균선. 컬러: 보라→핑크 그라디언트.' },
  { id: 'tm108-5-multi-step-typo', prompt: '키네틱 타이포그래피: "MOVE FAST. SHIP THINGS." 단어가 하나씩 커다랗게 들어왔다 나가고, 마지막에 두 줄이 겹쳐 정렬. 폰트: 굵은 산세리프. 배경: 검정. 강조 컬러: 형광 옐로.' },
];

const OUT = '/tmp/tm-114-validate';
fs.mkdirSync(OUT, { recursive: true });

interface ScanResult {
  brokenDestructure: number;     // `} = undefined`
  trailingEqUndefined: number;   // `= undefined;`
  bareRequire: number;
}

function scanArtefacts(code: string): ScanResult {
  return {
    brokenDestructure: (code.match(/\}\s*=\s*undefined\b/g) || []).length,
    trailingEqUndefined: (code.match(/=\s*undefined\s*;\s*$/gm) || []).length,
    bareRequire: (code.match(/\brequire\s*\(/g) || []).length,
  };
}

function evalReferenceCheck(jsCode: string): { ok: true } | { ok: false; error: string; phase: string } {
  try {
    const factory = new Function(
      'React', 'remotion', 'lucide',
      `"use strict";
      const { useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring, AbsoluteFill, Sequence, Img, Easing } = remotion;
      ${jsCode}
      if (typeof GeneratedAsset !== 'undefined') return GeneratedAsset;
      return null;`,
    );
    const stubReact = {
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => {
        // Eagerly invoke any function-typed children so Scene1/Scene2 ren-
        // dering happens here and surfaces destructure-of-undefined errors.
        // We DON'T actually render the tree — we just call each component
        // function with empty props.
        if (typeof type === 'function') {
          try { (type as Function)(props || {}); } catch (e) { throw e; }
        }
        return { type, props, children };
      },
      Fragment: Symbol('frag'),
    };
    const stubFn = () => 0;
    const stubRemotion = {
      useCurrentFrame: () => 0,
      useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 150 }),
      interpolate: stubFn,
      interpolateColors: () => '#000',
      spring: stubFn,
      AbsoluteFill: 'AbsoluteFill',
      Sequence: 'Sequence',
      Img: 'Img',
      Easing: { ease: stubFn, linear: stubFn, bezier: () => stubFn, out: () => stubFn, in: () => stubFn, inOut: () => stubFn, cubic: stubFn },
    };
    let result: unknown;
    try { result = factory(stubReact, stubRemotion, {}); }
    catch (err) { return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), phase: 'factory' }; }
    if (typeof result !== 'function') return { ok: false, error: 'no-component', phase: 'invoke' };
    try { (result as Function)({}); }
    catch (err) { return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), phase: 'render' }; }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), phase: 'outer' };
  }
}

async function main() {
  console.log(`[TM-114] validation — ${CASES.length} cases (AI_MULTI_STEP=${process.env.AI_MULTI_STEP})`);
  let pass = 0, fail = 0;
  const summary: Array<{ id: string; ok: boolean; scenes: number; artefacts: ScanResult; check: ReturnType<typeof evalReferenceCheck>; }> = [];
  for (const c of CASES) {
    console.log(`\n=== ${c.id} ===`);
    try {
      const t0 = Date.now();
      const result = await generateAssetMultiStep(c.prompt, 'gpt-4o');
      const ms = Date.now() - t0;
      console.log(`  pipeline ok (${ms}ms) — ${result.outline.scenes.length} scenes`);
      fs.writeFileSync(path.join(OUT, `${c.id}.tsx`), result.composedCode);
      fs.writeFileSync(path.join(OUT, `${c.id}.js`), result.asset.jsCode || '');
      const artefacts = scanArtefacts(result.composedCode);
      const check = evalReferenceCheck(result.asset.jsCode || '');
      const allClean = artefacts.brokenDestructure === 0 && artefacts.trailingEqUndefined === 0 && artefacts.bareRequire === 0 && check.ok;
      console.log(`  artefacts: brokenDestructure=${artefacts.brokenDestructure} trailingEqUndef=${artefacts.trailingEqUndefined} bareRequire=${artefacts.bareRequire}`);
      console.log(`  evaluator render: ${check.ok ? 'PASS' : 'FAIL [' + check.phase + '] — ' + check.error}`);
      if (allClean) { console.log('  → CLEAN'); pass++; } else { console.log('  → ISSUES'); fail++; }
      summary.push({ id: c.id, ok: allClean, scenes: result.outline.scenes.length, artefacts, check });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  pipeline FAILED — ${msg.slice(0, 200)}`);
      fail++;
      summary.push({ id: c.id, ok: false, scenes: 0, artefacts: { brokenDestructure: 0, trailingEqUndefined: 0, bareRequire: 0 }, check: { ok: false, error: msg, phase: 'pipeline' } });
    }
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[TM-114] PASS=${pass}/${CASES.length}  FAIL=${fail}/${CASES.length}`);
  console.log(`         summary: ${path.join(OUT, 'summary.json')}`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(2); });
