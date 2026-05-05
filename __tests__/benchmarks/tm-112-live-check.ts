/**
 * TM-112 — Live verification that the multi-step composer fix removes the
 * `ReferenceError: SceneNParams is not defined` runtime crash that hit
 * 5/5 cases in TM-108 r2.
 *
 * What this does:
 *   1. Logs in to the dev server (same /api/dev/auto-login flow as the
 *      TM-108 bench).
 *   2. Calls POST /api/generate for two of the worst-offender prompts
 *      from TM-108 r2 (chart + kinetic typo) under AI_MULTI_STEP=1.
 *   3. Pulls back the returned `jsCode` (already transpiled by the
 *      pipeline) and runs it through the same `evaluateComponentDetailed`
 *      that the studio client uses. A pre-fix run reproduces the
 *      ReferenceError; a post-fix run must produce a usable component.
 *
 * Run:
 *   AI_MULTI_STEP=1 PORT=3112 npm run dev    # in another terminal
 *   PORT=3112 npx tsx __tests__/benchmarks/tm-112-live-check.ts
 *
 * Cost: 2× full multi-step generate ≈ $0.4 (no judge calls — eval is local).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const PORT = process.env.PORT ?? '3112';
const HOST = process.env.HOSTNAME ?? '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

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

async function login(): Promise<string> {
  const cookies = new Map<string, string>();
  let url: string | null = `${BASE}/api/dev/auto-login?callbackUrl=/studio`;
  for (let hop = 0; hop < 6 && url; hop++) {
    const cookieHdr = Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    const res: Response = await fetch(url, {
      headers: cookieHdr ? { cookie: cookieHdr } : {},
      redirect: 'manual',
    });
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
  if (!sj?.user?.email) throw new Error(`login failed`);
  return cookie;
}

async function generate(prompt: string, cookie: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    return { ok: false as const, status: res.status, body: (await res.text()).slice(0, 400) };
  }
  const j = (await res.json()) as {
    type: string;
    asset?: { id: string; code?: string; jsCode?: string; durationInFrames: number; fps: number };
  };
  return { ok: true as const, asset: j.asset!, ms: Date.now() - t0 };
}

/**
 * Mimic the runtime path of `src/lib/remotion/evaluator.ts` *just enough*
 * to surface ReferenceError without pulling React into Node. We construct
 * the same Function with stub globals — if `Scene{N}Params` isn't in
 * scope, the factory throws at invocation time with the exact error the
 * client saw in TM-108 r2.
 */
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
    // Try invoking the component — this is where the PARAMS spread runs
    // (defaults at module top level already ran during factory body
    // construction; component invocation runs the JSX body which we stub).
    try {
      result({});
    } catch (err) {
      // JSX/React errors are expected (stub); only ReferenceError is fatal.
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
  console.log(`[TM-112] live verification — base=${BASE}`);
  const cookie = await login();
  console.log(`[TM-112] logged in`);

  let pass = 0;
  let fail = 0;
  for (const c of CASES) {
    console.log(`\n=== ${c.id} ===`);
    const gen = await generate(c.prompt, cookie);
    if (!gen.ok) {
      console.log(`  generate FAILED status=${gen.status} body=${gen.body}`);
      fail++;
      continue;
    }
    console.log(`  generate ok in ${gen.ms}ms (asset=${gen.asset.id})`);
    if (!gen.asset.jsCode) {
      console.log(`  no jsCode in response — cannot eval`);
      fail++;
      continue;
    }
    const ev = evalReferenceCheck(gen.asset.jsCode);
    if (ev.ok) {
      console.log(`  evaluator: PASS (no ReferenceError)`);
      pass++;
    } else {
      console.log(`  evaluator: FAIL — ${ev.error}`);
      // Dump first 600 chars of the source to help triage.
      console.log(
        `  jsCode head: ${gen.asset.jsCode.replace(/\n/g, ' ').slice(0, 600)}`,
      );
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
