/**
 * TM-114 — Live capture of multi-step composedCode + jsCode for triage.
 *
 * Calls generateAssetMultiStep on 2 short prompts, dumps composedCode + jsCode
 * to /tmp/tm-114-live/<id>.{tsx,js,json} so we can inspect why the rendered
 * component shows up as <Unknown> in ErrorBoundary at the studio.
 *
 * Run:  AI_MULTI_STEP=1 npx tsx __tests__/benchmarks/tm-114-live-capture.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { generateAssetMultiStep } from '../../src/lib/ai/pipeline';

const OUT = '/tmp/tm-114-live';
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  {
    id: 'tm114-simple-spinner',
    prompt: 'A simple loading spinner that rotates and fades in.',
  },
  {
    id: 'tm114-typo',
    prompt:
      '키네틱 타이포그래피: "MOVE FAST." 단어가 하나씩 커다랗게 등장. 폰트: 굵은 산세리프. 배경: 검정. 강조 컬러: 형광 옐로.',
  },
];

function evalReferenceCheck(jsCode: string): { ok: true; component: string } | { ok: false; error: string; phase: 'factory' | 'invoke' | 'render' } {
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
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
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
    let result: unknown;
    try {
      result = factory(stubReact, stubRemotion, {});
    } catch (err) {
      return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), phase: 'invoke' };
    }
    if (typeof result !== 'function') {
      return { ok: false, error: 'factory returned non-function: ' + typeof result, phase: 'invoke' };
    }
    // Try to render once
    try {
      const rendered = (result as Function)({});
      return { ok: true, component: typeof rendered };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), phase: 'render' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), phase: 'factory' };
  }
}

async function main() {
  console.log(`[TM-114] live capture (AI_MULTI_STEP=${process.env.AI_MULTI_STEP})`);
  for (const c of CASES) {
    console.log(`\n=== ${c.id} ===`);
    try {
      const t0 = Date.now();
      const result = await generateAssetMultiStep(c.prompt, 'gpt-4o');
      const ms = Date.now() - t0;
      console.log(`  pipeline ok in ${ms}ms — ${result.outline.scenes.length} scenes`);
      const composedPath = path.join(OUT, `${c.id}.tsx`);
      const jsPath = path.join(OUT, `${c.id}.js`);
      const metaPath = path.join(OUT, `${c.id}.json`);
      fs.writeFileSync(composedPath, result.composedCode);
      fs.writeFileSync(jsPath, result.asset.jsCode || '');
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            id: c.id,
            outline: result.outline,
            specs: result.sceneSpecs,
            durationInFrames: result.asset.durationInFrames,
            fps: result.asset.fps,
            costRatio: result.costRatio,
          },
          null,
          2,
        ),
      );
      console.log(`  wrote ${composedPath}`);
      const check = evalReferenceCheck(result.asset.jsCode || '');
      if (check.ok) {
        console.log(`  evaluator render: PASS (${check.component})`);
      } else {
        console.log(`  evaluator render: FAIL [${check.phase}] — ${check.error}`);
      }
    } catch (err) {
      console.log(`  pipeline FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
