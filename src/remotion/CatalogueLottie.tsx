/**
 * TM-140 / ADR-0027 — PARAMS-driven Lottie catalogue wrapper.
 *
 * # Why this exists
 *
 * Mirrors `<CatalogueAudio>` (ADR-0026 §B / TM-132). The bare `<Lottie>`
 * tag from `@remotion/lottie` accepts an arbitrary `animationData`
 * object, which means a freely-emittable `<Lottie>` would let the LLM
 * point at attacker-controlled JSON (or worse, a JSON with embedded
 * expressions that breaks Remotion's per-frame determinism contract —
 * see `getLottieMetadata` doc note on expression limits).
 *
 * The sandbox therefore denies bare `<Lottie>` and admits this wrapper
 * unconditionally. The wrapper validates `asset` against the catalogue
 * filename regex (mirrors `isValidCatalogueLottieAsset`), strips any
 * `lottie/` prefix, fetches `staticFile("lottie/<slug>.json")` inside
 * `useEffect` with `delayRender`/`continueRender` (the Remotion
 * doc-recommended pattern for static Lottie loading), and renders
 * `<Lottie animationData={...}>` only when the JSON has loaded. An
 * invalid `asset` renders `null` — never throws inside a render frame.
 *
 * # Security model
 *
 * `staticFile()` resolves the argument relative to `public/`. We restrict
 * the argument to `lottie/<slug>.json` with `<slug>` matching the
 * catalogue regex `^[a-z0-9-]+\.json$` (mirrors the audio policy). Path
 * traversal (`../`), backslashes, and embedded slashes are all rejected
 * before reaching `staticFile()`, so even a hostile PARAMS value cannot
 * escape `public/lottie/`.
 *
 * Membership against the actual on-disk catalogue is enforced upstream
 * by the picker UI and the LLM prompt — at render time we only enforce
 * the SHAPE so the Remotion render frame stays synchronous + side-effect
 * free until the `useEffect` fires.
 *
 * # Compatibility
 *
 * - Bare `<Lottie>` is denied by the sandbox (TM-140 deny addition).
 * - The wrapper itself is the canonical emission shape (TM-140-spawn-2
 *   prompt update).
 * - Customize-tab swap of `lottieAsset` PARAMS is pure ADR-0023 — no LLM
 *   round-trip; the wrapper re-fetches the new JSON on prop change.
 */
import { Lottie, type LottieAnimationData } from '@remotion/lottie';
import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
// TM-133 lesson re-applied: import directly from `manifest-types` so the
// Remotion bundle never reaches the fs-touching `manifest-loader`.
import { isValidCatalogueLottieAsset } from '@/lib/lottie/manifest-types';

export interface CatalogueLottieProps {
  /**
   * Catalogue asset filename. Accepts both the bare slug
   * (`bear-walk.json`) and the picker-canonical `lottie/`-prefixed form
   * (`lottie/bear-walk.json`). Anything else (variable garbage, path
   * traversal, wrong extension) renders nothing.
   */
  asset: string | null | undefined;
  /** Forwarded to `<Lottie>`. Defaults to true (most catalogue entries are loops). */
  loop?: boolean;
  /** Forwarded to `<Lottie>`. 1 = natural speed, 2 = double-speed, etc. */
  playbackRate?: number;
  /** Forwarded to `<Lottie>`. "forward" | "backward". */
  direction?: 'forward' | 'backward';
  /** Inline style passthrough — useful for sizing/positioning. */
  style?: React.CSSProperties;
  /** className passthrough. */
  className?: string;
}

export function CatalogueLottie({
  asset,
  loop = true,
  playbackRate = 1,
  direction = 'forward',
  style,
  className,
}: CatalogueLottieProps) {
  // Hooks must run unconditionally — even if `asset` is invalid we still
  // need to keep hook order stable across re-renders. The shape check
  // gates rendering, not hook execution.
  const [handle] = useState(() => delayRender('Loading catalogue Lottie'));
  const [animationData, setAnimationData] = useState<LottieAnimationData | null>(
    null,
  );

  const valid = isValidCatalogueLottieAsset(asset);
  // Strip optional `lottie/` prefix so we re-emit a single canonical
  // form into staticFile(); the upstream regex guarantees the result is
  // safe.
  const bare = valid ? (asset as string).replace(/^lottie\//, '') : null;

  useEffect(() => {
    if (!bare) {
      // Even when invalid we must release the delayRender handle, otherwise
      // Lambda export hangs forever waiting on a fetch that will never
      // start. continueRender is idempotent against accidental double-call
      // via React strict mode re-mount because we only acquire one handle
      // per component instance (initialised in useState lazy initialiser).
      continueRender(handle);
      return;
    }
    let cancelled = false;
    fetch(staticFile(`lottie/${bare}`))
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setAnimationData(json as LottieAnimationData);
        continueRender(handle);
      })
      .catch((err) => {
        if (cancelled) return;
        cancelRender(err);
      });
    return () => {
      cancelled = true;
    };
  }, [bare, handle]);

  if (!valid || !animationData) return null;
  return (
    <Lottie
      animationData={animationData}
      loop={loop}
      playbackRate={playbackRate}
      direction={direction}
      style={style}
      className={className}
    />
  );
}

CatalogueLottie.displayName = 'CatalogueLottie';
