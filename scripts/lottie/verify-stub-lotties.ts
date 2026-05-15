/**
 * TM-144 — sanity check the on-disk Lottie catalogue.
 *
 * Loads MANIFEST.json + every asset, validates:
 *   - manifest passes parseLottieManifest
 *   - every file's sha256 matches what manifest records
 *   - every JSON parses + has the minimum Lottie shape
 *     (top-level v / fr / ip / op / w / h / layers, layers length > 0)
 *   - durationFrames in manifest matches `op - ip`, fps matches `fr`
 *
 * Exits non-zero on any failure so it's safe to wire into CI.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseLottieManifest } from '../../src/lib/lottie/manifest-types';

// Inlined to avoid the `server-only` import in manifest-loader.ts (which is
// fine for Next.js routes but blows up in a plain tsx script).
async function loadLottieManifest() {
  const fp = path.join(process.cwd(), 'public', 'lottie', 'MANIFEST.json');
  return parseLottieManifest(JSON.parse(await readFile(fp, 'utf8')));
}

async function verifyLottieCatalogueIntegrity(
  manifest: Awaited<ReturnType<typeof loadLottieManifest>>,
) {
  const dir = path.join(process.cwd(), 'public', 'lottie');
  const issues: Array<{ filename: string; reason: string; expected?: string; actual?: string }> = [];
  for (const a of manifest.assets) {
    let buf: Buffer;
    try {
      buf = await readFile(path.join(dir, a.filename));
    } catch {
      issues.push({ filename: a.filename, reason: 'missing' });
      continue;
    }
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== a.sha256) {
      issues.push({ filename: a.filename, reason: 'sha256-mismatch', expected: a.sha256, actual });
    }
  }
  return issues;
}

async function main() {
  const manifest = await loadLottieManifest();
  const issues = await verifyLottieCatalogueIntegrity(manifest);
  if (issues.length > 0) {
    console.error('integrity issues:', JSON.stringify(issues, null, 2));
    process.exit(1);
  }
  const dir = path.join(process.cwd(), 'public', 'lottie');

  let failed = 0;
  for (const a of manifest.assets) {
    const text = await readFile(path.join(dir, a.filename), 'utf8');
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error(`${a.filename}: not valid JSON — ${(err as Error).message}`);
      failed++;
      continue;
    }
    const requiredKeys = ['v', 'fr', 'ip', 'op', 'w', 'h', 'layers'] as const;
    for (const k of requiredKeys) {
      if (!(k in json)) {
        console.error(`${a.filename}: missing top-level "${k}"`);
        failed++;
      }
    }
    if (!Array.isArray(json.layers) || json.layers.length === 0) {
      console.error(`${a.filename}: layers must be non-empty array`);
      failed++;
    }
    const dur = (json.op as number) - (json.ip as number);
    if (dur !== a.durationFrames) {
      console.error(
        `${a.filename}: manifest durationFrames=${a.durationFrames} but Lottie op-ip=${dur}`,
      );
      failed++;
    }
    if (json.fr !== a.fps) {
      console.error(
        `${a.filename}: manifest fps=${a.fps} but Lottie fr=${json.fr}`,
      );
      failed++;
    }
    console.log(
      `ok ${a.filename}  v=${json.v}  ${json.w}x${json.h}  ${dur}f@${json.fr}fps  layers=${(json.layers as unknown[]).length}`,
    );
  }
  if (failed > 0) {
    console.error(`\n${failed} validation failure(s)`);
    process.exit(1);
  }
  console.log(`\nall ${manifest.assets.length} assets ok`);
}

void main();
