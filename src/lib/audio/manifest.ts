/**
 * Audio catalogue manifest loader (ADR-0026 §1, TM-127).
 *
 * The catalogue is a closed enum of royalty-free tracks shipped under
 * `public/audio/`. The LLM emits `<Audio src={staticFile("audio/<name>.mp3")} />`
 * referencing one of these filenames; downstream sandbox + customize-UI work
 * (TM-126-spawn-{2,4}) consume this loader.
 *
 * Validation is intentionally plain TS (no zod) — schema is small and stable.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type AudioMood =
  | 'chill'
  | 'upbeat'
  | 'cinematic'
  | 'lofi'
  | 'electronic';

export const AUDIO_MOODS: readonly AudioMood[] = [
  'chill',
  'upbeat',
  'cinematic',
  'lofi',
  'electronic',
] as const;

export interface AudioTrack {
  /** e.g. "chill-sunrise.mp3" — must match `^[a-z0-9-]+\.mp3$`. */
  filename: string;
  mood: AudioMood;
  bpm: number;
  durationSec: number;
  /** SPDX-style identifier (e.g. "CC0-1.0", "MIT-0"). */
  license: string;
  attribution?: string;
  /** Lowercase hex sha256 of the asset bytes. */
  sha256: string;
  /** Asset size in bytes (informational; not enforced by validator). */
  bytes?: number;
}

export interface AudioManifest {
  $schema?: string;
  version: number;
  note?: string;
  tracks: AudioTrack[];
}

export class AudioManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioManifestError';
  }
}

const FILENAME_RE = /^[a-z0-9-]+\.mp3$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

/** Default location when the loader is invoked from a Next.js server context. */
export const DEFAULT_MANIFEST_PATH = path.join(
  process.cwd(),
  'public',
  'audio',
  'MANIFEST.json',
);

/**
 * Parse + validate a manifest document. Throws AudioManifestError on any
 * structural issue. Pure function — does not touch disk.
 */
export function parseAudioManifest(raw: unknown): AudioManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AudioManifestError('manifest must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== 'number' || obj.version !== 1) {
    throw new AudioManifestError(
      `unsupported manifest version: ${String(obj.version)} (expected 1)`,
    );
  }
  if (!Array.isArray(obj.tracks)) {
    throw new AudioManifestError('manifest.tracks must be an array');
  }
  if (obj.tracks.length === 0) {
    throw new AudioManifestError('manifest.tracks must not be empty');
  }

  const seen = new Set<string>();
  const tracks: AudioTrack[] = obj.tracks.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AudioManifestError(`tracks[${idx}] must be an object`);
    }
    const t = entry as Record<string, unknown>;

    if (typeof t.filename !== 'string' || !FILENAME_RE.test(t.filename)) {
      throw new AudioManifestError(
        `tracks[${idx}].filename must match ${FILENAME_RE} (got ${JSON.stringify(t.filename)})`,
      );
    }
    if (seen.has(t.filename)) {
      throw new AudioManifestError(
        `tracks[${idx}].filename duplicate: ${t.filename}`,
      );
    }
    seen.add(t.filename);

    if (typeof t.mood !== 'string' || !AUDIO_MOODS.includes(t.mood as AudioMood)) {
      throw new AudioManifestError(
        `tracks[${idx}].mood must be one of ${AUDIO_MOODS.join('|')} (got ${JSON.stringify(t.mood)})`,
      );
    }
    if (typeof t.bpm !== 'number' || !Number.isFinite(t.bpm) || t.bpm <= 0) {
      throw new AudioManifestError(`tracks[${idx}].bpm must be a positive number`);
    }
    if (
      typeof t.durationSec !== 'number' ||
      !Number.isFinite(t.durationSec) ||
      t.durationSec <= 0
    ) {
      throw new AudioManifestError(
        `tracks[${idx}].durationSec must be a positive number`,
      );
    }
    if (typeof t.license !== 'string' || t.license.length === 0) {
      throw new AudioManifestError(`tracks[${idx}].license must be a non-empty string`);
    }
    if (typeof t.sha256 !== 'string' || !SHA256_RE.test(t.sha256)) {
      throw new AudioManifestError(
        `tracks[${idx}].sha256 must be a 64-char lowercase hex string`,
      );
    }
    if (
      t.attribution !== undefined &&
      (typeof t.attribution !== 'string' || t.attribution.length === 0)
    ) {
      throw new AudioManifestError(
        `tracks[${idx}].attribution must be a non-empty string when present`,
      );
    }
    if (t.bytes !== undefined && (typeof t.bytes !== 'number' || t.bytes < 0)) {
      throw new AudioManifestError(
        `tracks[${idx}].bytes must be a non-negative number when present`,
      );
    }

    return {
      filename: t.filename,
      mood: t.mood as AudioMood,
      bpm: t.bpm,
      durationSec: t.durationSec,
      license: t.license,
      sha256: t.sha256,
      ...(t.attribution !== undefined ? { attribution: t.attribution as string } : {}),
      ...(t.bytes !== undefined ? { bytes: t.bytes as number } : {}),
    };
  });

  return {
    ...(typeof obj.$schema === 'string' ? { $schema: obj.$schema } : {}),
    version: 1,
    ...(typeof obj.note === 'string' ? { note: obj.note } : {}),
    tracks,
  };
}

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
