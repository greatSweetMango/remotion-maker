/**
 * Audio catalogue — client-safe types, constants, and pure validators
 * (TM-133 split out from `manifest.ts`).
 *
 * # Why this file exists
 *
 * The original `manifest.ts` colocated:
 *   (a) plain TS types + a sync regex predicate (`isValidCatalogTrack`), AND
 *   (b) a Node-only loader using `node:fs/promises` + `node:crypto`.
 *
 * `CatalogueAudio.tsx` (a Remotion component, bundled into the Next.js
 * client/edge graph via `evaluator.ts → TemplateCard → _LandingClient.tsx`)
 * imported (a) but transitively dragged in (b). Turbopack's client chunking
 * context cannot resolve `node:fs/promises`, breaking the landing page
 * build (TM-133, mirrors TM-81 prisma-bundle-leak).
 *
 * Same fix shape: split the module along the server/client boundary so
 * client-reachable code only ever touches the regex + types in this file.
 * The fs-touching loader lives in `manifest-loader.ts` and is only reached
 * from API routes / build scripts.
 *
 * Everything in THIS file MUST stay free of `node:*` imports and remain
 * synchronous + side-effect free so it is safe to import from a Remotion
 * render frame or a client component.
 */

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

export const FILENAME_RE = /^[a-z0-9-]+\.mp3$/;
export const SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * TM-132 / ADR-0026 §B amendment — catalogue filename shape predicate.
 *
 * Synchronous, side-effect free (no fs read), safe to call inside a Remotion
 * render frame. Accepts either a bare filename (`chill-sunrise.mp3`) or the
 * `audio/`-prefixed form the picker emits (`audio/chill-sunrise.mp3`).
 *
 * The check is a SHAPE check, not a manifest membership check — it mirrors
 * the regex the sandbox enforces so that:
 *   - an attacker setting `bgmTrack='../etc/passwd'` is rejected here,
 *   - and `staticFile()` only ever receives a string of the form
 *     `audio/<slug>.mp3` with `<slug>` matching the catalogue regex.
 *
 * Membership against the actual on-disk catalogue is enforced upstream:
 *   - the BgmTrackControl picker only emits values it pulled from
 *     `/api/audio/manifest`,
 *   - and the LLM prompt restricts the literal string to catalogue moods.
 */
export function isValidCatalogTrack(track: unknown): track is string {
  if (typeof track !== 'string' || track.length === 0) return false;
  const bare = track.replace(/^audio\//, '');
  if (bare.includes('/') || bare.includes('\\') || bare.includes('..')) return false;
  return FILENAME_RE.test(bare);
}

/**
 * Parse + validate a manifest document. Throws AudioManifestError on any
 * structural issue. Pure function — does not touch disk, safe to call from
 * any runtime (browser, edge, node).
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
