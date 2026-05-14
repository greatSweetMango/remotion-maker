/**
 * Audio catalogue — server-only loader (TM-133 split out from `manifest.ts`).
 *
 * Reads + verifies `public/audio/MANIFEST.json` from disk using
 * `node:fs/promises` and `node:crypto`. Importing this file from a
 * client-reachable module will break the Turbopack/Webpack build the
 * same way TM-81 (prisma) and TM-133 (this file's predecessor) did.
 *
 * Allowed importers:
 *   - API routes / route handlers (`src/app/api/**`)
 *   - Build / verification scripts under `scripts/`
 *   - Tests (vitest runs in node)
 *
 * Forbidden importers:
 *   - Anything under `src/remotion/**` (Remotion bundles render with the
 *     client chunking context)
 *   - Anything under `src/components/**` that ships to the browser
 *   - Landing / marketing pages
 *
 * For client-safe types, regex, and the sync `isValidCatalogTrack`
 * predicate, import from `./manifest-types` instead.
 */
import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AudioManifestError,
  parseAudioManifest,
  type AudioManifest,
} from './manifest-types';

/** Default location when the loader is invoked from a Next.js server context. */
export const DEFAULT_MANIFEST_PATH = path.join(
  process.cwd(),
  'public',
  'audio',
  'MANIFEST.json',
);

/** Read + validate the manifest from disk. */
export async function loadAudioManifest(
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): Promise<AudioManifest> {
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new AudioManifestError(
      `failed to read audio manifest at ${manifestPath}: ${(err as Error).message}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new AudioManifestError(
      `audio manifest is not valid JSON: ${(err as Error).message}`,
    );
  }
  return parseAudioManifest(json);
}

/**
 * Hash an asset buffer the same way the manifest records hashes
 * (lowercase hex sha256). Useful for the integrity check below + tests.
 */
export function hashAudioAsset(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface AudioIntegrityIssue {
  filename: string;
  reason: 'missing' | 'sha256-mismatch';
  expected?: string;
  actual?: string;
}

/**
 * Verify each manifest entry exists on disk and matches the recorded sha256.
 * Returns issues; empty array means the catalogue is intact.
 */
export async function verifyAudioCatalogueIntegrity(
  manifest: AudioManifest,
  audioDir: string = path.dirname(DEFAULT_MANIFEST_PATH),
): Promise<AudioIntegrityIssue[]> {
  const issues: AudioIntegrityIssue[] = [];
  for (const track of manifest.tracks) {
    const fp = path.join(audioDir, track.filename);
    let buf: Buffer;
    try {
      buf = await readFile(fp);
    } catch {
      issues.push({ filename: track.filename, reason: 'missing' });
      continue;
    }
    const actual = hashAudioAsset(buf);
    if (actual !== track.sha256) {
      issues.push({
        filename: track.filename,
        reason: 'sha256-mismatch',
        expected: track.sha256,
        actual,
      });
    }
  }
  return issues;
}
