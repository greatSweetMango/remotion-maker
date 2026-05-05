/**
 * TM-112 — Direct pipeline verification (no DB).
 *
 * Imports the same `generateAssetMultiStep` orchestrator the /api/generate
 * route uses, runs it on the two worst-offender prompts from TM-108 r2,
 * then evaluates the resulting `jsCode` through a Node-side reproduction
 * of the studio evaluator. A pre-fix run reproduced
 * `ReferenceError: SceneNParams is not defined`; a post-fix run must
 * produce a usable component (factory returns a function and invocation
 * does not throw a ReferenceError).
 *
 * This bypasses /api/generate entirely so DB schema drift on the local
 * SQLite (which is unrelated to TM-112) does not block verification.
 *
 * Run:  AI_MULTI_STEP=1 npx tsx __tests__/benchmarks/tm-112-pipeline-direct.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

// Import after env is loaded so OpenAI client picks up keys.
import { generateAssetMultiStep } from '../../src/lib/ai/pipeline';
import { transpileTSX } from '../../src/lib/remotion/transpiler';
import { sanitizeCode } from '../../src/lib/remotion/sandbox';

const CASES = [
  {
    id: 'tm112-chart',
    prompt:
      '월별 매출 비교 인포그래픽. 1월 100, 2월 150, 3월 220, 4월 280 (단위: 백만원). 각 막대에 숫자 라벨, 좌측에 Y축 그리드, 상단에 "2026 H1 매출 성장" 타이틀. 컬러: 보라→핑크 그라디언트.',
  },
  {
    id: 'tm112-typo',
    prompt:
      '키네틱 타이포그래피: "MOVE FAST. SHIP THINGS." 단어가 하나씩 커다랗게 들어왔다 나가고, 마지막에 두 줄이 겹쳐 정렬. 폰트: 굵은 산세리프. 배경: 검정. 강조 컬러: 형광 옐로.',
  },
];

function evalReferenceCheck(jsCode: string): { ok: true } | { ok: false; error: string } {
  try {
    const factory = new Function(
      'React',
      'remotion',
      'lucide',
      `
      "use strict";
      const {
        useCurrentFrame, useVideoConfig, interpolate, interpolateColors,
        spring, AbsoluteFill, Sequence, Img, Easing
      } = remotion;
      ${jsCode}
      if (typeof GeneratedAsset !== 'undefined') return GeneratedAsset;
      return null;
      `,
    );
    const stubReact = {
      createElement: () => null,
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
      Easing: { ease: stubFn, linear: stubFn, bezier: () => stubFn },
    };
    const result = factory(stubReact, stubRemotion, {});
    if (typeof result !== 'function') {
      return { ok: false, error: 'no-component' };
    }
    try {
      result({});
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (/ReferenceError/.test(msg)) return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, error: msg };
  }
}

async function main() {
  console.log(`[TM-112] direct pipeline verification`);
  let pass = 0;
  let fail = 0;
  for (const c of CASES) {
    console.log(`\n=== ${c.id} ===`);
    try {
      const t0 = Date.now();
      const result = await generateAssetMultiStep(c.prompt, 'gpt-4o');
      const ms = Date.now() - t0;
      console.log(`  pipeline ok in ${ms}ms — ${result.outline.scenes.length} scenes`);
      // The orchestrator already transpiled jsCode onto result.asset.
      const jsCode = result.asset.jsCode;
      if (!jsCode) {
        // Fallback: transpile manually from composedCode.
        const sanitized = sanitizeCode(result.composedCode);
        const transpiled = await transpileTSX(sanitized);
        console.log(`  (fallback transpile of composedCode, ${transpiled.length} chars)`);
        const ev = evalReferenceCheck(transpiled);
        console.log(`  evaluator: ${ev.ok ? 'PASS' : 'FAIL — ' + ev.error}`);
        if (ev.ok) pass++; else fail++;
        continue;
      }
      const ev = evalReferenceCheck(jsCode);
      if (ev.ok) {
        console.log(`  evaluator: PASS (no ReferenceError)`);
        pass++;
      } else {
        console.log(`  evaluator: FAIL — ${ev.error}`);
        console.log(`  composedCode head: ${result.composedCode.replace(/\n/g, ' ').slice(0, 800)}`);
        fail++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  pipeline FAILED — ${msg.slice(0, 400)}`);
      fail++;
    }
  }
  console.log(`\n[TM-112] pass=${pass}/${CASES.length}  fail=${fail}/${CASES.length}`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
