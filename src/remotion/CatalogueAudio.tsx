/**
 * TM-132 / ADR-0026 §B amendment — PARAMS-driven BGM swap wrapper.
 *
 * # Why this exists
 *
 * TM-128 sandbox accepts `<Audio>` only when `src` is a literal call to
 * `staticFile("audio/<slug>.mp3")` (no variables, no template strings).
 * TM-130 customize-tab picker mutates `PARAMS.bgmTrack` to swap tracks.
 * Those two contracts are mutually unsatisfiable: the picker's PARAMS
 * mutation is a no-op for the literal `<Audio src={staticFile("…")} />`
 * the sandbox forces. The picker shipped, but in practice did nothing.
 *
 * This wrapper resolves the tension by exposing a single allow-listed JSX
 * tag (`<CatalogueAudio>`) whose `track` prop CAN flow from PARAMS:
 *
 *     <CatalogueAudio track={bgmTrack} volume={bgmVolume} />
 *
 * The sandbox grants `<CatalogueAudio>` an unconditional allow (it's not
 * a Remotion media tag — Remotion only sees the `<Audio>` *inside* this
 * component, with a known-shape literal `staticFile()` arg). Variable /
 * dynamic / external `track` values are filtered to `null` here, so a
 * malformed prop renders silently instead of triggering the `Html5Audio
 * src` runtime cascade that TM-123 fixed.
 *
 * # Security model
 *
 * `staticFile()` resolves the argument relative to `public/`. We restrict
 * the argument to `audio/<slug>.mp3` with `<slug>` matching the
 * catalogue regex `^[a-z0-9-]+\.mp3$` (mirrors `isValidCatalogTrack`).
 * Path traversal (`../`), backslashes, and embedded slashes are all
 * rejected before reaching `staticFile()`, so even a hostile PARAMS
 * value cannot escape `public/audio/`.
 *
 * Membership against the *actual* catalogue (filenames in
 * `public/audio/MANIFEST.json`) is enforced upstream by the picker UI
 * and the LLM prompt — at render time we only enforce the SHAPE so the
 * Remotion render frame stays synchronous + side-effect free.
 *
 * # Compatibility
 *
 * - The legacy literal `<Audio src={staticFile("audio/<name>.mp3")} />`
 *   shape (TM-128) still passes the sandbox — generated code from the
 *   prior prompt revision keeps working.
 * - This wrapper is the *new* recommended emission shape; the prompt
 *   (TM-129) is updated to prefer it whenever PARAMS.bgmTrack exists.
 */
import { Audio, staticFile } from 'remotion';
import { isValidCatalogTrack } from '@/lib/audio/manifest';

export interface CatalogueAudioProps {
  /**
   * Catalogue track filename. Accepts both the bare slug
   * (`chill-sunrise.mp3`) and the picker-canonical `audio/`-prefixed form
   * (`audio/chill-sunrise.mp3`). Anything else (variable garbage, path
   * traversal, wrong extension) renders nothing.
   */
  track: string | null | undefined;
  /** Standard Remotion volume (0–1 or a frame-driven function). */
  volume?: number | ((frame: number) => number);
  /** Forwarded to Remotion `<Audio>` — see Remotion docs. */
  startFrom?: number;
  /** Forwarded to Remotion `<Audio>`. */
  endAt?: number;
  /** Playback rate multiplier (1 = normal). */
  playbackRate?: number;
  /** Mute control — useful for preview muting at the studio level. */
  muted?: boolean;
}

export function CatalogueAudio({
  track,
  volume = 0.6,
  startFrom,
  endAt,
  playbackRate,
  muted,
}: CatalogueAudioProps) {
  if (!isValidCatalogTrack(track)) return null;
  // Strip optional `audio/` prefix so we re-emit a single canonical form
  // into staticFile(); the upstream regex guarantees the result is safe.
  const bare = (track as string).replace(/^audio\//, '');
  return (
    <Audio
      src={staticFile(`audio/${bare}`)}
      volume={volume}
      startFrom={startFrom}
      endAt={endAt}
      playbackRate={playbackRate}
      muted={muted}
    />
  );
}

CatalogueAudio.displayName = 'CatalogueAudio';
