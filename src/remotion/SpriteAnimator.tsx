/**
 * TM-142 — PARAMS-driven sprite-sheet walk-cycle component.
 *
 * # Why this exists
 *
 * Pairs with `src/lib/ai/sprite-sheet-stage.ts`. That stage generates 4
 * separate PNGs (frame 1..4, side view, transparent background); this
 * component cycles through them at a configurable fps so the subject
 * actually appears to walk. Sliding a single still PNG with `translateX`
 * (the TM-90 single-image fallback) produces a teleporting billboard;
 * cycling through 4 leg-pose frames produces a recognisable walk cycle
 * without any external animation dependency (no `lottie`, no `sharp`,
 * no `canvas`).
 *
 * # Animation contract
 *
 * Picks the active frame from the current Remotion frame:
 *
 *     index = floor((currentFrame * fps) / videoFps) % frames.length
 *
 * `fps` here is the *animation* fps (cycle speed), separate from the
 * composition fps (rendering rate). Defaults to 8 — fast enough to read
 * as movement on a 4-frame cycle, slow enough that adjacent frames are
 * distinguishable. Caller can raise it for sprinting or lower it for a
 * stroll.
 *
 * # Security model
 *
 * Frame URLs MUST point at `/uploads/sprites/<hash>/<n>.png` — the same
 * hash-keyed layout the sprite-sheet stage writes. Anything else (raw
 * filesystem path, `..`, external https URL) renders nothing. We're
 * deliberately strict because PARAMS values are LLM-controlled and a
 * permissive `<Img src>` would let a hostile prompt point at an
 * attacker-controlled image. Mirrors the `<CatalogueLottie>` /
 * `<CatalogueAudio>` allow-shape philosophy.
 *
 * Bare `<Img>` is still permitted by the sandbox (it's needed by the
 * TM-136 single-image flow), so this wrapper is opt-in: the LLM emits
 * `<SpriteAnimator frames={PARAMS.spriteFrames} fps={8} />` rather than
 * 4 hand-rolled `<Img>` calls.
 *
 * # Sandbox / evaluator wiring
 *
 * Exposed to the evaluator factory as a positional argument (see
 * `src/lib/remotion/evaluator.ts`). The sandbox sanitiser strips any
 * stray `import { SpriteAnimator } from "@/remotion/SpriteAnimator"`
 * so the LLM can write the import without breaking evaluation.
 */
import { Img, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * Frame URLs MUST match `/uploads/sprites/<hash>/<n>.png` where `<hash>`
 * is hex (sha256) and `<n>` is a positive integer. Absolute filesystem
 * paths, `..` traversal, external URLs, and wrong extensions all FAIL
 * this check and the component renders nothing — never throws.
 */
const SPRITE_FRAME_URL_RE = /^\/uploads\/sprites\/[a-f0-9]+\/[0-9]+\.png$/;

export function isValidSpriteFrameUrl(url: unknown): url is string {
  return typeof url === 'string' && SPRITE_FRAME_URL_RE.test(url);
}

/**
 * Validate a frames array. Returns the array iff every entry passes the
 * url check AND the array is non-empty; otherwise null.
 */
export function validateSpriteFrames(frames: unknown): string[] | null {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  for (const f of frames) {
    if (!isValidSpriteFrameUrl(f)) return null;
  }
  return frames as string[];
}

export interface SpriteAnimatorProps {
  /**
   * Ordered list of frame URLs. Must point at the sprite-sheet stage's
   * canonical layout; anything else renders nothing.
   */
  frames: string[] | null | undefined;
  /**
   * Animation fps (cycle speed), independent of composition fps.
   * Defaults to 8 — readable cadence on a 4-frame cycle.
   */
  fps?: number;
  /**
   * When true, the cycle wraps with `% frames.length`. When false the
   * subject freezes on the last frame after one pass. Defaults to true.
   */
  loop?: boolean;
  /** Inline style passthrough — useful for sizing / positioning. */
  style?: React.CSSProperties;
  className?: string;
}

export function SpriteAnimator({
  frames,
  fps = 8,
  loop = true,
  style,
  className,
}: SpriteAnimatorProps) {
  // Hooks must run unconditionally so hook order is stable across
  // PARAMS-driven re-renders that toggle frames between valid/invalid.
  const currentFrame = useCurrentFrame();
  const { fps: videoFps } = useVideoConfig();

  const valid = validateSpriteFrames(frames);
  if (!valid) return null;

  // Guard against pathological fps values (0 or negative) — pick the
  // anchor frame so the render stays deterministic.
  const animFps = Number.isFinite(fps) && fps > 0 ? fps : 8;
  const safeVideoFps = videoFps > 0 ? videoFps : 30;

  const rawIndex = Math.floor((currentFrame * animFps) / safeVideoFps);
  const index = loop
    ? ((rawIndex % valid.length) + valid.length) % valid.length
    : Math.min(rawIndex, valid.length - 1);

  return (
    <Img
      src={valid[index]}
      style={style}
      className={className}
    />
  );
}

SpriteAnimator.displayName = 'SpriteAnimator';
