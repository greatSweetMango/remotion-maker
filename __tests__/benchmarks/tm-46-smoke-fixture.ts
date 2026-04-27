/**
 * TM-46 — smoke fixture generator.
 *
 * 풀 파이프라인(dev 서버 + Prisma + auth + Remotion render + Playwright capture)
 * 을 단일 CI/agent 세션에서 돌리기는 비싸므로, judge 스크립트의 동작 경로를
 * 검증하기 위한 합성 fixture (1×1 PNG placeholder + 인공 점수) 를 생성한다.
 *
 * 실 운영에서는 capture 단계가 실제 PNG 를 생성하고, 이 fixture 는 사용 안 함.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TM46_SMOKE_PROMPTS, CAPTURE_FRAMES } from './tm-46-prompts';

// 1×1 흑색 PNG 의 base64 (placeholder)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function writeTiny(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(TINY_PNG_B64, 'base64'));
}

function main() {
  const outDir = path.join(__dirname, 'results', 'tm-46', 'screenshots');
  let count = 0;
  for (const p of TM46_SMOKE_PROMPTS) {
    for (const f of CAPTURE_FRAMES) {
      writeTiny(path.join(outDir, `${p.id}-${f}.png`));
      count++;
    }
  }
  console.log(`[fixture] wrote ${count} placeholder PNGs to ${outDir}`);
}

if (require.main === module) main();
