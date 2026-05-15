/**
 * Lottie catalogue — backward-compat / convenience client-safe barrel
 * (TM-140 / ADR-0027).
 *
 * Mirrors `src/lib/audio/manifest.ts` — a CLIENT-SAFE re-export of the
 * `manifest-types` surface so callers can write `@/lib/lottie/manifest`
 * without worrying about which sub-file holds what. Code that needs the
 * fs loader MUST import from `@/lib/lottie/manifest-loader` directly —
 * re-exporting it here would defeat the split (anything importing this
 * file would once again drag `node:fs` into the client graph, the
 * TM-133 failure mode).
 */
export {
  LottieManifestError,
  LOTTIE_FILENAME_RE,
  LOTTIE_SHA256_RE,
  isValidCatalogueLottieAsset,
  parseLottieManifest,
  type LottieAsset,
  type LottieManifest,
} from './manifest-types';
