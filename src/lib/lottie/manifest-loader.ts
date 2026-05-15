/**
 * Lottie catalogue — server-only loader (TM-140 / ADR-0027).
 *
 * Reads + verifies `public/lottie/MANIFEST.json` from disk using
 * `node:fs/promises` and `node:crypto`. Importing this file from a
 * client-reachable module will break the Turbopack/Webpack build the
 * same way TM-81 (prisma) and TM-133 (audio) did. Same split shape as
 * `src/lib/audio/manifest-loader.ts`.
 *
 * Allowed importers:
 *   - API routes / route handlers (`src/app/api/**`)
 *   - Build / verification scripts under `scripts/`
 *   - Tests (jest runs in node)
 *
 * Forbidden importers:
 *   - Anything under `src/remotion/**`
 *   - Anything under `src/components/**` that ships to the browser
 *   - Landing / marketing pages
 *
 * For client-safe types, regex, and the sync `isValidCatalogueLottieAsset`
 * predicate, import from `./manifest-types` instead.
 */
import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  LottieManifestError,
  parseLottieManifest,
  type LottieManifest,
} from './manifest-types';

/** Default location when the loader is invoked from a Next.js server context. */
export const DEFAULT_LOTTIE_MANIFEST_PATH = path.join(
  process.cwd(),
  'public',
  'lottie',
  'MANIFEST.json',
);

/** Read + validate the manifest from disk. */
export async function loadLottieManifest(
  manifestPath: string = DEFAULT_LOTTIE_MANIFEST_PATH,
): Promise<LottieManifest> {
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new LottieManifestError(
      `failed to read lottie manifest at ${manifestPath}: ${(err as Error).message}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new LottieManifestError(
      `lottie manifest is not valid JSON: ${(err as Error).message}`,
    );
  }
  return parseLottieManifest(json);
}

/**
 * Hash an asset buffer the same way the manifest records hashes
 * (lowercase hex sha256). Useful for the integrity check below + tests.
 */
export function hashLottieAsset(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface LottieIntegrityIssue {
  filename: string;
  reason: 'missing' | 'sha256-mismatch';
  expected?: string;
  actual?: string;
}

/**
 * Verify each manifest entry exists on disk and matches the recorded
 * sha256. Returns issues; empty array means the catalogue is intact.
 */
export async function verifyLottieCatalogueIntegrity(
  manifest: LottieManifest,
  lottieDir: string = path.dirname(DEFAULT_LOTTIE_MANIFEST_PATH),
): Promise<LottieIntegrityIssue[]> {
  const issues: LottieIntegrityIssue[] = [];
  for (const asset of manifest.assets) {
    const fp = path.join(lottieDir, asset.filename);
    let buf: Buffer;
    try {
      buf = await readFile(fp);
    } catch {
      issues.push({ filename: asset.filename, reason: 'missing' });
      continue;
    }
    const actual = hashLottieAsset(buf);
    if (actual !== asset.sha256) {
      issues.push({
        filename: asset.filename,
        reason: 'sha256-mismatch',
        expected: asset.sha256,
        actual,
      });
    }
  }
  return issues;
}
