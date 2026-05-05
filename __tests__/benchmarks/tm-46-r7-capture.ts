/**
 * TM-46 r7 — RAG-ON vs RAG-OFF capture driver.
 *
 * Reads $TM46_R7_MODE in {"rag-on","rag-off"} and writes to
 *   __tests__/benchmarks/results/tm-46-r7/<mode>/screenshots/<id>-<frame>.png
 * + capture-manifest-<mode>.json.
 *
 * The actual RAG toggle lives on the **server** side via $RAG_DISABLE; this
 * script simply records which mode the corresponding dev server was running
 * in, so capture and judge stages can be replayed.
 *
 * Usage:
 *   # 1) start dev with RAG_DISABLE=1 (or unset for ON)
 *   # 2) TM46_R7_MODE=rag-on  npx tsx __tests__/benchmarks/tm-46-r7-capture.ts
 *   # 3) restart dev w/ opposite RAG_DISABLE; rerun w/ TM46_R7_MODE=rag-off
 *
 * TM-46 r7 retro budget = 25min: this driver supports a soft per-run wall
 * clock via $TM46_R7_DEADLINE_MS (epoch ms). When reached we stop and
 * persist whatever has been captured (partial result). Judge then runs only
 * on prompts present in the manifest with framesCaptured.length > 0.
 */

import * as fs from 'fs';
import * as path from 'path';
import { openBrowser, ensureBrowser } from '@remotion/renderer';
import { TM46_PROMPTS, CAPTURE_FRAMES } from './tm-46-prompts';

const PORT = process.env.PORT ?? '3046';
const HOST = process.env.HOSTNAME ?? '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const MODE = (process.env.TM46_R7_MODE ?? 'rag-on') as 'rag-on' | 'rag-off';
const ROOT_OUT = path.join(__dirname, 'results', 'tm-46-r7', MODE);
const OUT_DIR = path.join(ROOT_OUT, 'screenshots');
const MANIFEST_PATH = path.join(ROOT_OUT, 'capture-manifest.json');
const DEADLINE_MS = Number(process.env.TM46_R7_DEADLINE_MS ?? 0);

interface CaptureItem {
  id: string;
  prompt: string;
  category: string;
  assetId?: string;
  framesCaptured: number[];
  error?: string;
  generationMs?: number;
  captureMs?: number;
}

function deadlineHit(): boolean {
  return DEADLINE_MS > 0 && Date.now() >= DEADLINE_MS;
}

async function login(): Promise<string> {
  // Use /api/dev/auto-login (DEV_AUTO_LOGIN=true) — handles user upsert + signIn
  // in one shot. Follow redirects manually to collect Set-Cookie chain.
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

async function generateAsset(prompt: string, cookie: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as {
    type: string;
    asset?: { id: string; durationInFrames: number; fps: number; width: number; height: number };
  };
  if (j.type !== 'generate' || !j.asset) throw new Error(`unexpected: ${JSON.stringify(j).slice(0, 200)}`);
  console.log(`  [gen ${Date.now() - t0}ms] ${j.asset.id}`);
  return j.asset;
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
    context: 'tm-46-r7', logLevel: 'error', indent: false,
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Optional ID filter via $TM46_R7_IDS (comma-separated). Useful for paired
  // RAG-ON / RAG-OFF runs on the same subset under tight budget.
  const idFilter = process.env.TM46_R7_IDS ? new Set(process.env.TM46_R7_IDS.split(',')) : null;
  const promptList = idFilter ? TM46_PROMPTS.filter((p) => idFilter.has(p.id)) : TM46_PROMPTS;
  console.log(`[TM-46 r7] mode=${MODE} prompts=${promptList.length} deadline=${
    DEADLINE_MS ? new Date(DEADLINE_MS).toISOString() : 'none'
  }`);
  const cookie = await login();
  console.log(`[TM-46 r7] login ok`);
  await ensureBrowser();
  const browser = await openBrowser('chrome', { headless: true } as never);
  console.log(`[TM-46 r7] chrome ready`);

  const items: CaptureItem[] = [];
  let idx = 0;
  for (const p of promptList) {
    idx++;
    if (deadlineHit()) {
      console.log(`[TM-46 r7] DEADLINE HIT at ${idx}/${promptList.length} — stop`);
      break;
    }
    console.log(`\n[${idx}/${promptList.length}] ${p.id} "${p.prompt.slice(0, 50)}"`);
    const item: CaptureItem = { id: p.id, prompt: p.prompt, category: p.category, framesCaptured: [] };
    const tStart = Date.now();
    try {
      const a = await generateAsset(p.prompt, cookie);
      item.assetId = a.id;
      item.generationMs = Date.now() - tStart;
      const tCap = Date.now();
      let pageIdx = 0;
      for (const frame of CAPTURE_FRAMES) {
        if (deadlineHit()) break;
        const targetFrame = Math.min(frame, Math.max(0, a.durationInFrames - 1));
        const outPath = path.join(OUT_DIR, `${p.id}-${frame}.png`);
        try {
          await captureFrame({ browser, cookie, assetId: a.id, frame: targetFrame, outPath, pageIndex: idx * 10 + pageIdx++ });
          item.framesCaptured.push(frame);
          console.log(`    [cap] frame=${targetFrame}`);
        } catch (e) {
          console.log(`    [cap-fail] ${(e as Error).message}`);
        }
      }
      item.captureMs = Date.now() - tCap;
    } catch (e) {
      item.error = (e as Error).message;
      console.log(`  [error] ${item.error}`);
    }
    items.push(item);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ mode: MODE, ran_at: new Date().toISOString(), items }, null, 2));
  }

  // @ts-expect-error
  await browser.close().catch(() => {});
  const ok = items.filter((i) => i.framesCaptured.length === CAPTURE_FRAMES.length).length;
  const partial = items.filter((i) => i.framesCaptured.length > 0 && i.framesCaptured.length < CAPTURE_FRAMES.length).length;
  const failed = items.filter((i) => i.framesCaptured.length === 0).length;
  console.log(`\n[TM-46 r7] DONE mode=${MODE} full=${ok} partial=${partial} failed=${failed}/${items.length}`);
}

main().catch((e) => { console.error('[TM-46 r7 FATAL]', e); process.exit(1); });
