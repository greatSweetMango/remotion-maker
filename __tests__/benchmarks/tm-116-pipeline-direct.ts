/**
 * TM-116 — Direct pipeline verification for the 5 EB cases from TM-108 r4.
 *
 * TM-108 r4 reported 3/5 multi-step renders trip the studio's
 * EvaluatorErrorBoundary: case 1 (`<Scene1>` throw), cases 2 & 3
 * (`<Unknown>` throw). TM-116 hardens the composer (per-scene boundary +
 * displayName) and the evaluator (expanded Remotion globals destructure).
 * This script reruns the same 5 prompts through `generateAssetMultiStep`
 * and verifies:
 *   - Pipeline returns 200 (5/5 generate).
 *   - Composed module compiles + factory invocation does not throw.
 *   - Rendering the resulting component once does not throw a
 *     ReferenceError (the failure mode that surfaced as EB in r4).
 *
 * Stub React/remotion mirrors evaluator.ts's destructure so any name that
 * is in scope at runtime is also in scope here. Adds the TM-116 expanded
 * set (Series, Loop, Audio, staticFile, random, …).
 *
 * Run:
 *   AI_MULTI_STEP=1 npx tsx __tests__/benchmarks/tm-116-pipeline-direct.ts
 *
 * Cost: ~$0.5 (gpt-4o multi-step × 5, no judge).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { generateAssetMultiStep, generateAssetMultiStepAsApiResponse } from '../../src/lib/ai/pipeline';
import { transpileTSX } from '../../src/lib/remotion/transpiler';
import { sanitizeCode } from '../../src/lib/remotion/sandbox';

const CASES = [
  {
    id: 'tm116-1-baseline-simple',
    prompt: '심플한 로딩 스피너 8개 점, 파란색',
  },
  {
    id: 'tm116-2-long-video',
    prompt:
      '60초짜리 회사 소개 영상. 인트로(로고+태그라인) → 핵심 가치 3개 → CTA. 톤: 미니멀 + 진한 네이비.',
  },
  {
    id: 'tm116-3-url-ingest',
    prompt:
      'Hacker News 스타일의 뉴스 헤드라인 카드 슬라이드쇼. 첨부 컨텍스트의 색감/문구 사용.\n\n[ATTACHED CONTEXT]\nsource: https://news.ycombinator.com\ntitle: Hacker News\npalette: [\'#ff6600\', \'#f6f6ef\', \'#828282\']\nheadlines:\n  - "Show HN: A new way to ship products"\n  - "Why we left the cloud"\n[/ATTACHED CONTEXT]',
  },
  {
    id: 'tm116-4-multi-step-chart',
    prompt:
      '월별 매출 비교 인포그래픽. 1월 100, 2월 150, 3월 220, 4월 280, 5월 360, 6월 480. 각 막대에 숫자 라벨, 상단에 "2026 H1 매출 성장" 타이틀. 컬러: 보라→핑크 그라디언트.',
  },
  {
    id: 'tm116-5-multi-step-typo',
    prompt:
      '키네틱 타이포그래피: "MOVE FAST. SHIP THINGS." 단어가 하나씩 커다랗게 들어왔다 나가고, 마지막에 두 줄이 겹쳐 정렬. 폰트: 굵은 산세리프. 배경: 검정. 강조 컬러: 형광 옐로.',
  },
];

interface CaseResult {
  id: string;
  generate: 'PASS' | 'FAIL';
  evaluator: 'PASS' | 'FAIL';
  scenes?: number;
  ms?: number;
  error?: string;
}

function stubReactElement(): any {
  // Return a plain object so children iterate without throwing — mimics a
  // React element shape just enough to walk the tree.
  return { type: 'stub', props: { children: [] } };
}

function buildStubs() {
  const stubFn = () => 0;
  const stubReact: any = {
    createElement: (_t: any, _p: any, ..._c: any[]) => stubReactElement(),
    Fragment: Symbol('frag'),
    Component: class StubComponent {
      props: any;
      state: any;
      constructor(props: any) {
        this.props = props;
        this.state = {};
      }
      setState(s: any) {
        this.state = { ...this.state, ...s };
      }
      render() {
        return null;
      }
    },
  };
  const stubRemotion: any = {
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 150 }),
    interpolate: stubFn,
    interpolateColors: () => '#000',
    spring: stubFn,
    AbsoluteFill: 'AbsoluteFill',
    Sequence: 'Sequence',
    Series: { Sequence: 'Series.Sequence' },
    Loop: 'Loop',
    Freeze: 'Freeze',
    Img: 'Img',
    Easing: { ease: stubFn, linear: stubFn, bezier: () => stubFn, in: stubFn, out: stubFn, inOut: stubFn },
    Audio: 'Audio',
    Video: 'Video',
    OffthreadVideo: 'OffthreadVideo',
    IFrame: 'IFrame',
    staticFile: (s: string) => s,
    random: (_s: string | number) => 0.5,
    delayRender: () => 0,
    continueRender: () => undefined,
    cancelRender: () => undefined,
    prefetch: () => ({ waitUntilDone: async () => undefined }),
    getInputProps: () => ({}),
    getRemotionEnvironment: () => ({ isRendering: false }),
    getStaticFiles: () => [],
    watchStaticFile: () => undefined,
    Composition: 'Composition',
    Still: 'Still',
    Folder: 'Folder',
    registerRoot: () => undefined,
  };
  return { stubReact, stubRemotion };
}

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
        spring, AbsoluteFill, Sequence, Series, Loop, Freeze, Img, Easing,
        Audio, Video, OffthreadVideo, IFrame, staticFile, random,
        delayRender, continueRender, cancelRender, prefetch,
        getInputProps, getRemotionEnvironment, getStaticFiles, watchStaticFile,
        Composition, Still, Folder, registerRoot
      } = remotion;
      ${jsCode}
      if (typeof GeneratedAsset !== 'undefined') return GeneratedAsset;
      return null;
      `,
    );
    const { stubReact, stubRemotion } = buildStubs();
    const result = factory(stubReact, stubRemotion, {});
    if (typeof result !== 'function') {
      return { ok: false, error: 'no-component' };
    }
    try {
      result({});
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (/ReferenceError/.test(msg)) return { ok: false, error: msg };
      // Non-ReferenceError thrown during render is acceptable here — Remotion
      // stubs are minimal and may trip type errors we don't care about. The
      // EB symptom we're hunting is ReferenceError specifically.
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, error: msg };
  }
}

async function main() {
  console.log(`[TM-116] direct pipeline verification — 5 EB cases from TM-108 r4`);
  const results: CaseResult[] = [];
  for (const c of CASES) {
    console.log(`\n=== ${c.id} ===`);
    const r: CaseResult = { id: c.id, generate: 'FAIL', evaluator: 'FAIL' };
    try {
      const t0 = Date.now();
      const result = await generateAssetMultiStep(c.prompt, 'gpt-4o');
      r.ms = Date.now() - t0;
      r.scenes = result.outline.scenes.length;
      r.generate = 'PASS';
      console.log(`  generate: PASS in ${r.ms}ms — ${r.scenes} scenes`);

      let jsCode = result.asset.jsCode;
      if (!jsCode) {
        const sanitized = sanitizeCode(result.composedCode);
        jsCode = await transpileTSX(sanitized);
      }
      const ev = evalReferenceCheck(jsCode!);
      if (ev.ok) {
        r.evaluator = 'PASS';
        console.log(`  evaluator: PASS (no ReferenceError at render)`);
      } else {
        r.evaluator = 'FAIL';
        r.error = ev.error;
        console.log(`  evaluator: FAIL — ${ev.error}`);
        console.log(`  composedCode head: ${result.composedCode.replace(/\n/g, ' ').slice(0, 600)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      r.error = msg.slice(0, 400);
      console.log(`  pipeline FAILED — ${r.error}`);
      if (err instanceof Error && (err as any).stack) {
        console.log(`  stack: ${(err as any).stack.split('\n').slice(0, 4).join('\n')}`);
      }
    }
    results.push(r);
  }

  const generatePass = results.filter(r => r.generate === 'PASS').length;
  const evaluatorPass = results.filter(r => r.evaluator === 'PASS').length;
  console.log(`\n[TM-116] generate=${generatePass}/${CASES.length}  evaluator=${evaluatorPass}/${CASES.length}`);
  console.log(JSON.stringify(results, null, 2));
  if (evaluatorPass < CASES.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
