/**
 * TM-46 — Playwright capture driver.
 *
 * Pre-condition:
 *   - dev 서버 실행 중 (`npm run dev -- --port 3046 --turbo`)
 *   - dev-login 으로 인증된 cookie 또는 NEXT_AUTH 비활성 환경
 *
 * 동작:
 *   1. 각 프롬프트 generate API 호출 → assetId 획득
 *   2. /studio?asset=<id> 페이지 진입
 *   3. Remotion Player frame 시킹 → 60/90/180 프레임 screenshot
 *   4. PNG 저장: results/tm-46/screenshots/<id>-<frame>.png
 *
 * 본 환경에서는 dev DB 의존(Prisma + auth) 때문에 실제 fully-automated 실행은
 * 별도 인증 cookie / dev-login API 가 필요. 본 스크립트는 그 entrypoint 다.
 *
 * 사용:
 *   PORT=3046 ANTHROPIC_API_KEY=... npx tsx __tests__/benchmarks/tm-46-capture.ts \
 *     [--smoke] [--cookie <auth.session-token=...>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { TM46_PROMPTS, TM46_SMOKE_PROMPTS, CAPTURE_FRAMES } from './tm-46-prompts';

const PORT = process.env.PORT ?? '3046';
const BASE = `http://localhost:${PORT}`;

interface CaptureItem {
  id: string;
  prompt: string;
  assetId?: string;
  framesCaptured: number[];
  error?: string;
}

async function generate(prompt: string, cookie: string): Promise<string> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`generate failed ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { type: string; asset?: { id: string } };
  if (j.type !== 'generate' || !j.asset?.id) throw new Error(`generate returned ${j.type}`);
  return j.asset.id;
}

/**
 * Playwright capture는 mcp__plugin_playwright_playwright__browser_*
 * 도구로 수행한다. 이 스크립트는 단독 실행이 아니라 TeamLead 가
 * 단계별로 호출하는 helper 라이브러리로도 동작.
 */
export async function captureViaFetch(opts: {
  smoke?: boolean;
  cookie: string;
  outDir: string;
}): Promise<CaptureItem[]> {
  const prompts = opts.smoke ? TM46_SMOKE_PROMPTS : TM46_PROMPTS;
  const results: CaptureItem[] = [];

  fs.mkdirSync(opts.outDir, { recursive: true });

  for (const p of prompts) {
    const item: CaptureItem = { id: p.id, prompt: p.prompt, framesCaptured: [] };
    try {
      const assetId = await generate(p.prompt, opts.cookie);
      item.assetId = assetId;
      // 실제 Playwright screenshot 단계는 TeamLead 에서 MCP 도구로 진행:
      //   1. browser_navigate(`${BASE}/studio?asset=${assetId}&frame=${frame}`)
      //   2. browser_wait_for(text 또는 timeout 1.5s)
      //   3. browser_take_screenshot({ filename: `${id}-${frame}.png` })
      // 본 함수는 assetId 까지만 확보. 프레임 수집은 외부 스크립트가 수행.
    } catch (e) {
      item.error = (e as Error).message;
    }
    results.push(item);
  }

  fs.writeFileSync(
    path.join(opts.outDir, 'capture-manifest.json'),
    JSON.stringify({ ran_at: new Date().toISOString(), items: results }, null, 2),
  );

  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const cookieIdx = args.indexOf('--cookie');
  const cookie = cookieIdx >= 0 ? args[cookieIdx + 1] : process.env.AUTH_COOKIE ?? '';
  if (!cookie) {
    console.error('--cookie or AUTH_COOKIE env required (next-auth session token).');
    process.exit(1);
  }
  const outDir = path.join(__dirname, 'results', 'tm-46', 'screenshots');
  captureViaFetch({ smoke, cookie, outDir }).then((items) => {
    const ok = items.filter((i) => !!i.assetId && !i.error).length;
    console.log(`generate ok=${ok}/${items.length}`);
    console.log(
      `next: Playwright MCP 로 ${items
        .filter((i) => i.assetId)
        .map((i) => i.assetId)
        .join(',')} 의 frame 60/90/180 screenshot 수집.`,
    );
  });
}

export { CAPTURE_FRAMES };
