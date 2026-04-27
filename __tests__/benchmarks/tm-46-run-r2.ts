/**
 * TM-46 r2 — full execution driver.
 *
 * Pipeline:
 *   1. Authenticate via dev-login (NextAuth credentials) → session cookie.
 *   2. For each prompt in TM46_PROMPTS:
 *      a. POST /api/generate → assetId.
 *      b. For each frame in CAPTURE_FRAMES:
 *         - Open /studio?asset=<id>&frame=<N> in headless chromium (with cookie).
 *         - Wait for Player to render → screenshot the player container.
 *      c. Save 3 PNGs to results/tm-46/screenshots/<id>-<frame>.png.
 *   3. Hand off to tm-46-judge.ts (separate step) for Opus scoring.
 *
 * Browser: uses @remotion/renderer.openBrowser (already a project dep,
 * downloads its own chromium on first run).
 *
 * Auth: uses curl-style fetch with stored cookies (avoids Playwright MCP
 * sandbox network issue observed in this environment).
 *
 * Usage:
 *   set -a; source .env.local; set +a;
 *   npx tsx __tests__/benchmarks/tm-46-run-r2.ts [--smoke]
 */

import * as fs from 'fs';
import * as path from 'path';
import { openBrowser, ensureBrowser } from '@remotion/renderer';
import { TM46_PROMPTS, TM46_SMOKE_PROMPTS, CAPTURE_FRAMES } from './tm-46-prompts';

const PORT = process.env.PORT ?? '3046';
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = path.join(__dirname, 'results', 'tm-46', 'screenshots');
const MANIFEST_PATH = path.join(__dirname, 'results', 'tm-46', 'capture-manifest.json');

interface CaptureItem {
  id: string;
  prompt: string;
  category: string;
  assetId?: string;
  framesCaptured: number[];
  durationInFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  error?: string;
  generationMs?: number;
  captureMs?: number;
}

async function login(): Promise<string> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const setCookies1 = csrfRes.headers.getSetCookie?.() ?? [];
  const csrfCookie = setCookies1.map((c) => c.split(';')[0]).join('; ');

  const body = new URLSearchParams({
    csrfToken,
    email: 'dev@localhost',
    password: 'dev-bypass-key',
    callbackUrl: '/studio',
  });
  const authRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      cookie: csrfCookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'manual',
  });
  const setCookies2 = authRes.headers.getSetCookie?.() ?? [];
  const authPairs = setCookies2.map((c) => c.split(';')[0]).filter(Boolean);
  const allPairs = [...csrfCookie.split('; '), ...authPairs].filter(Boolean);
  const cookie = Array.from(new Map(allPairs.map((p) => [p.split('=')[0], p])).values()).join('; ');

  // Verify
  const sess = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } });
  const sj = (await sess.json()) as { user?: { email?: string } };
  if (!sj.user?.email) throw new Error(`login failed: session=${JSON.stringify(sj)}`);
  return cookie;
}

async function generateAsset(
  prompt: string,
  cookie: string,
): Promise<{
  id: string;
  title: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`generate ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as {
    type: string;
    asset?: {
      id: string;
      title: string;
      durationInFrames: number;
      fps: number;
      width: number;
      height: number;
    };
  };
  if (j.type !== 'generate' || !j.asset) throw new Error(`unexpected response: ${JSON.stringify(j).slice(0, 200)}`);
  console.log(`  [gen ${Date.now() - t0}ms] ${j.asset.id} "${j.asset.title}"`);
  return j.asset;
}

async function captureFrame(opts: {
  browser: Awaited<ReturnType<typeof openBrowser>>;
  cookie: string;
  assetId: string;
  frame: number;
  outPath: string;
  width: number;
  height: number;
  pageIndex: number;
}): Promise<void> {
  // remotion's openBrowser yields a stripped puppeteer-like surface.
  // newPage signature: { context, logLevel, indent, pageIndex, onBrowserLog, onLog }.
  // Page lacks setCookie/screenshot, but exposes _client() for raw CDP.
  // The 'context' field is typed as a SourceMapGetter (private impl) — at runtime
  // any string identifier is accepted, hence the cast.
  const browserAny = opts.browser as unknown as {
    newPage: (args: {
      context: unknown;
      logLevel: string;
      indent: boolean;
      pageIndex: number;
      onBrowserLog: null;
      onLog: () => void;
    }) => Promise<{
      _client: () => { send: (method: string, params?: unknown) => Promise<unknown> };
      goto: (args: { url: string; timeout: number }) => Promise<unknown>;
      close: () => Promise<unknown>;
    }>;
  };
  const page = await browserAny.newPage({
    context: 'tm-46-r2',
    logLevel: 'error',
    indent: false,
    pageIndex: opts.pageIndex,
    onBrowserLog: null,
    onLog: () => {},
  });
  try {
    const client = page._client();

    // Inject auth cookies via Network domain (CDP).
    const cookies = opts.cookie.split('; ').map((kv) => {
      const eq = kv.indexOf('=');
      const name = kv.slice(0, eq);
      const value = kv.slice(eq + 1);
      return {
        name,
        value,
        domain: 'localhost',
        path: '/',
        httpOnly: name.includes('session-token'),
        secure: false,
        sameSite: 'Lax' as const,
      };
    });
    await client.send('Network.setCookies', { cookies });

    // Set viewport via CDP.
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const url = `${BASE}/studio?asset=${opts.assetId}&frame=${opts.frame}`;
    await page.goto({ url, timeout: 30000 });

    // Allow Remotion Player to mount + seekTo to settle.
    await new Promise((r) => setTimeout(r, 2500));

    // Capture screenshot via CDP. remotion's CDPSession returns { value, size }.
    const shotResp = (await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })) as { value?: { data: string }; data?: string };
    const data = shotResp.value?.data ?? shotResp.data;
    if (!data) throw new Error(`screenshot returned no data: ${JSON.stringify(shotResp).slice(0, 200)}`);
    fs.writeFileSync(opts.outPath, Buffer.from(data, 'base64'));
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const smoke = process.argv.includes('--smoke');
  const prompts = smoke ? TM46_SMOKE_PROMPTS : TM46_PROMPTS;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[TM-46 r2] mode=${smoke ? 'smoke' : 'full'} prompts=${prompts.length}`);
  console.log(`[TM-46 r2] login...`);
  const cookie = await login();
  console.log(`[TM-46 r2] login ok. cookie pairs=${cookie.split('; ').length}`);

  console.log(`[TM-46 r2] ensureBrowser...`);
  await ensureBrowser();
  const browser = await openBrowser('chrome', { headless: true } as never);
  console.log(`[TM-46 r2] chrome ready`);

  const items: CaptureItem[] = [];
  let idx = 0;
  for (const p of prompts) {
    idx++;
    console.log(`\n[${idx}/${prompts.length}] ${p.id} "${p.prompt.slice(0, 60)}"`);
    const item: CaptureItem = {
      id: p.id,
      prompt: p.prompt,
      category: p.category,
      framesCaptured: [],
    };
    const tStart = Date.now();
    try {
      const a = await generateAsset(p.prompt, cookie);
      item.assetId = a.id;
      item.durationInFrames = a.durationInFrames;
      item.fps = a.fps;
      item.width = a.width;
      item.height = a.height;
      item.generationMs = Date.now() - tStart;

      const tCap = Date.now();
      let pageIdx = 0;
      for (const frame of CAPTURE_FRAMES) {
        const targetFrame = Math.min(frame, Math.max(0, a.durationInFrames - 1));
        const outPath = path.join(OUT_DIR, `${p.id}-${frame}.png`);
        try {
          await captureFrame({
            browser,
            cookie,
            assetId: a.id,
            frame: targetFrame,
            outPath,
            width: a.width,
            height: a.height,
            pageIndex: idx * 10 + pageIdx++,
          });
          item.framesCaptured.push(frame);
          console.log(`    [cap] frame=${targetFrame} → ${path.basename(outPath)}`);
        } catch (e) {
          console.log(`    [cap-fail] frame=${targetFrame}: ${(e as Error).message}`);
        }
      }
      item.captureMs = Date.now() - tCap;
    } catch (e) {
      item.error = (e as Error).message;
      console.log(`  [error] ${item.error}`);
    }
    items.push(item);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ ran_at: new Date().toISOString(), items }, null, 2));
  }

  // @ts-expect-error
  await browser.close().catch(() => {});

  const ok = items.filter((i) => i.framesCaptured.length === CAPTURE_FRAMES.length).length;
  const partial = items.filter((i) => i.framesCaptured.length > 0 && i.framesCaptured.length < CAPTURE_FRAMES.length).length;
  const failed = items.filter((i) => i.framesCaptured.length === 0).length;
  console.log(`\n[TM-46 r2] DONE. full=${ok} partial=${partial} failed=${failed} / total=${items.length}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

main().catch((e) => {
  console.error('[TM-46 r2 FATAL]', e);
  process.exit(1);
});
