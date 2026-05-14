/**
 * Audio catalogue — backward-compat barrel (TM-133).
 *
 * Pre-TM-133 this file held BOTH the client-safe types/predicates AND the
 * `node:fs/promises` loader. Importing the predicate from a Remotion
 * component (`CatalogueAudio.tsx`, TM-132) transitively pulled `node:fs`
 * into the Turbopack client chunking context, breaking the landing-page
 * build with:
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs/promises)
 *
 * Same failure shape as TM-81 (prisma client bundle leak). The fix is the
 * same: split the module along the server/client boundary.
 *
 *   - Client-safe (regex, types, AUDIO_MOODS, isValidCatalogTrack,
 *     parseAudioManifest) → `./manifest-types`
 *   - Server-only (loadAudioManifest, hashAudioAsset, integrity check,
 *     DEFAULT_MANIFEST_PATH) → `./manifest-loader`
 *
 * This file remains as a CLIENT-SAFE barrel so existing import sites
 * (`@/lib/audio/manifest`) keep working as long as they only consume the
 * client-safe surface. Code that needs the fs loader MUST import from
 * `@/lib/audio/manifest-loader` directly — re-exporting it here would
 * defeat the split (anything importing from this file would once again
 * drag `node:fs` into the client graph).
 */

export {
  AUDIO_MOODS,
  AudioManifestError,
  FILENAME_RE,
  SHA256_RE,
  isValidCatalogTrack,
  parseAudioManifest,
  type AudioManifest,
  type AudioMood,
  type AudioTrack,
} from './manifest-types';
