/**
 * TM-179 — detect whether generated asset code actually mounts an audio
 * tag, so the Player can pass `numberOfSharedAudioTags={0}` when it does
 * not. With the default (5), `@remotion/player` pre-mounts 5 silent
 * `<audio src=data:...>` elements via `SharedAudioContextProvider` to
 * sidestep the browser autoplay policy on a later real `<Audio>` mount
 * (see `node_modules/remotion/dist/cjs/audio/shared-audio-tags.js:343`).
 *
 * On a page that has not received a user gesture (e.g. fresh studio load,
 * SSR/CSR boundary, hot reload), Chromium fails those silent tags and
 * spams "AudioContext encountered an error" — 30+ lines per Player mount
 * — even though the *user-visible* TM-123 deny list correctly rejects
 * `<Audio>` in the generated code. The TM-123 four-layer defence stops
 * generated code from emitting `<Audio>`, but the silent pre-allocated
 * tags are a Player-internal path that no sandbox guard reaches.
 *
 * The fix: when the asset's compiled JS contains no `<Audio>` /
 * `<CatalogueAudio>` reference, set `numberOfSharedAudioTags={0}` so
 * `SharedAudioContextProvider` skips the silent-tag pre-allocation. The
 * SharedAudioContext itself still exists (Player hardcodes
 * `audioEnabled: true` and we cannot override it), but with zero
 * `<audio>` DOM elements there is no autoplay-policy probe and Chromium
 * stays quiet. When the asset *does* use CatalogueAudio, the default
 * (5) is preserved so real audio playback continues to work.
 */

/**
 * Returns true iff the supplied generated component source string
 * references either `<Audio` or `<CatalogueAudio` JSX tags. Uses a
 * word-boundary at the end of the tag name so legitimate user
 * components whose names merely *begin* with "Audio" (e.g.
 * `<AudioBars>`, `<AudioVisualizer>` — common in TM-123 era prompts)
 * are NOT misclassified as audio-emitting.
 *
 * Operates on the post-transpile JS string (what the evaluator
 * receives) rather than the TSX source, because `jsCode` is what's
 * stored on the asset and what the Player ultimately renders.
 */
export function compositionUsesAudio(jsCode: string | null | undefined): boolean {
  if (!jsCode) return false;

  // TM-123 sandbox rejects `<Audio>` in generated code, but the literal
  // also appears in the CatalogueAudio wrapper itself once it has been
  // bundled into the asset. We treat both as "audio in use".
  //
  // Patterns:
  //   - JSX: `<Audio …>` / `<CatalogueAudio …>` — pre-transpile / dev only
  //   - Transpiled: `_jsx(Audio,` / `React.createElement(Audio,`
  //     `_jsx(CatalogueAudio,` etc — production / runtime bundle
  //
  // The `\b` boundary prevents `<AudioBars>` from matching.
  const patterns: RegExp[] = [
    /<\s*Audio\b/, // <Audio …
    /<\s*CatalogueAudio\b/, // <CatalogueAudio …
    /\b_?jsxs?\s*\(\s*Audio\b/, // _jsx(Audio, … / jsx(Audio, …
    /\b_?jsxs?\s*\(\s*CatalogueAudio\b/,
    /createElement\s*\(\s*Audio\b/, // React.createElement(Audio, …
    /createElement\s*\(\s*CatalogueAudio\b/,
  ];

  return patterns.some(p => p.test(jsCode));
}

/**
 * Pick the right `numberOfSharedAudioTags` value for a Player mount.
 * - Asset emits audio → keep Remotion default (5).
 * - Asset is visual-only → 0, which short-circuits the silent-tag
 *   pre-allocation and ends the autoplay-policy console flood.
 */
export function sharedAudioTagsForAsset(jsCode: string | null | undefined): number {
  return compositionUsesAudio(jsCode) ? 5 : 0;
}
