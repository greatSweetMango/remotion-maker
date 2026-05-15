/**
 * Lottie catalogue — client-safe types, constants, and pure validators
 * (TM-140 / ADR-0027). Mirrors `src/lib/audio/manifest-types.ts` shape so
 * engineers familiar with the audio policy can navigate this by analogy.
 *
 * # Why this file exists (and why the split with `manifest-loader.ts`)
 *
 * `CatalogueLottie.tsx` is a Remotion component bundled into the Next.js
 * client/edge graph (via `evaluator.ts → TemplateCard → _LandingClient.tsx`).
 * It needs the shape predicate (`isValidCatalogueLottieAsset`) at render
 * time. If that predicate lived alongside a `node:fs/promises` loader,
 * Turbopack would drag the fs import into the client chunking context and
 * break the landing-page build — exactly the failure shape TM-133 fixed for
 * the audio module (which itself mirrored TM-81 prisma-bundle-leak).
 *
 * Keep this file synchronous, side-effect free, and free of `node:*`
 * imports so it stays safe to import from a Remotion render frame or a
 * client component. The fs-touching loader lives in `manifest-loader.ts`.
 */

export interface LottieAsset {
  /** e.g. "bear-walk.json" — must match `^[a-z0-9-]+\.json$`. */
  filename: string;
  /**
   * Living-entity subject — used by the prompt enum + customize UI search.
   * Free-form string today (curation-driven); a future ADR may close this
   * into an enum once the catalogue stabilises.
   */
  subject: string;
  /**
   * Short motion description (e.g. "side-view bear walking loop") —
   * surfaced verbatim in the system-prompt catalogue listing so the LLM
   * can pick the right entry.
   */
  motion: string;
  /** Natural duration of the Lottie animation, in frames. */
  durationFrames: number;
  /** Natural framerate of the Lottie animation. */
  fps: number;
  /** SPDX-style identifier (e.g. "CC0-1.0", "MIT-0", "MIT"). */
  license: string;
  attribution?: string;
  /** Lowercase hex sha256 of the asset bytes. */
  sha256: string;
  /** Asset size in bytes (informational; not enforced by validator). */
  bytes?: number;
}

export interface LottieManifest {
  $schema?: string;
  version: number;
  note?: string;
  assets: LottieAsset[];
}

export class LottieManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LottieManifestError';
  }
}

export const LOTTIE_FILENAME_RE = /^[a-z0-9-]+\.json$/;
export const LOTTIE_SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * TM-140 / ADR-0027 — catalogue filename shape predicate.
 *
 * Synchronous, side-effect free (no fs read), safe to call inside a
 * Remotion render frame. Accepts either a bare filename
 * (`bear-walk.json`) or the `lottie/`-prefixed form the picker emits
 * (`lottie/bear-walk.json`).
 *
 * The check is a SHAPE check, not a manifest membership check — it
 * mirrors the regex the sandbox enforces so that:
 *   - an attacker setting `lottieAsset='../etc/passwd'` is rejected
 *     here,
 *   - and `staticFile()` only ever receives a string of the form
 *     `lottie/<slug>.json` with `<slug>` matching the catalogue regex.
 *
 * Membership against the actual on-disk catalogue is enforced upstream:
 *   - the customize-tab Lottie picker only emits values it pulled from
 *     the manifest API,
 *   - and the LLM prompt restricts the literal string to the closed
 *     catalogue enum.
 */
export function isValidCatalogueLottieAsset(asset: unknown): asset is string {
  if (typeof asset !== 'string' || asset.length === 0) return false;
  const bare = asset.replace(/^lottie\//, '');
  if (bare.includes('/') || bare.includes('\\') || bare.includes('..')) return false;
  return LOTTIE_FILENAME_RE.test(bare);
}

/**
 * Parse + validate a manifest document. Throws LottieManifestError on any
 * structural issue. Pure function — does not touch disk, safe to call
 * from any runtime (browser, edge, node).
 */
export function parseLottieManifest(raw: unknown): LottieManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LottieManifestError('manifest must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== 'number' || obj.version !== 1) {
    throw new LottieManifestError(
      `unsupported manifest version: ${String(obj.version)} (expected 1)`,
    );
  }
  if (!Array.isArray(obj.assets)) {
    throw new LottieManifestError('manifest.assets must be an array');
  }
  if (obj.assets.length === 0) {
    throw new LottieManifestError('manifest.assets must not be empty');
  }

  const seen = new Set<string>();
  const assets: LottieAsset[] = obj.assets.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LottieManifestError(`assets[${idx}] must be an object`);
    }
    const a = entry as Record<string, unknown>;

    if (typeof a.filename !== 'string' || !LOTTIE_FILENAME_RE.test(a.filename)) {
      throw new LottieManifestError(
        `assets[${idx}].filename must match ${LOTTIE_FILENAME_RE} (got ${JSON.stringify(a.filename)})`,
      );
    }
    if (seen.has(a.filename)) {
      throw new LottieManifestError(
        `assets[${idx}].filename duplicate: ${a.filename}`,
      );
    }
    seen.add(a.filename);

    if (typeof a.subject !== 'string' || a.subject.length === 0) {
      throw new LottieManifestError(`assets[${idx}].subject must be a non-empty string`);
    }
    if (typeof a.motion !== 'string' || a.motion.length === 0) {
      throw new LottieManifestError(`assets[${idx}].motion must be a non-empty string`);
    }
    if (
      typeof a.durationFrames !== 'number' ||
      !Number.isFinite(a.durationFrames) ||
      a.durationFrames <= 0
    ) {
      throw new LottieManifestError(
        `assets[${idx}].durationFrames must be a positive number`,
      );
    }
    if (typeof a.fps !== 'number' || !Number.isFinite(a.fps) || a.fps <= 0) {
      throw new LottieManifestError(`assets[${idx}].fps must be a positive number`);
    }
    if (typeof a.license !== 'string' || a.license.length === 0) {
      throw new LottieManifestError(`assets[${idx}].license must be a non-empty string`);
    }
    if (typeof a.sha256 !== 'string' || !LOTTIE_SHA256_RE.test(a.sha256)) {
      throw new LottieManifestError(
        `assets[${idx}].sha256 must be a 64-char lowercase hex string`,
      );
    }
    if (
      a.attribution !== undefined &&
      (typeof a.attribution !== 'string' || a.attribution.length === 0)
    ) {
      throw new LottieManifestError(
        `assets[${idx}].attribution must be a non-empty string when present`,
      );
    }
    if (a.bytes !== undefined && (typeof a.bytes !== 'number' || a.bytes < 0)) {
      throw new LottieManifestError(
        `assets[${idx}].bytes must be a non-negative number when present`,
      );
    }

    return {
      filename: a.filename,
      subject: a.subject,
      motion: a.motion,
      durationFrames: a.durationFrames,
      fps: a.fps,
      license: a.license,
      sha256: a.sha256,
      ...(a.attribution !== undefined ? { attribution: a.attribution as string } : {}),
      ...(a.bytes !== undefined ? { bytes: a.bytes as number } : {}),
    };
  });

  return {
    ...(typeof obj.$schema === 'string' ? { $schema: obj.$schema } : {}),
    version: 1,
    ...(typeof obj.note === 'string' ? { note: obj.note } : {}),
    assets,
  };
}
