/**
 * Instant variant — quick hover-driven overrides for the template gallery (TM-35).
 *
 * Goal: when a user hovers a thumbnail, expose a *minimal* mini-control strip
 * (one color picker + one speed slider) that re-skins the live preview without
 * leaving the gallery. Picks complement TM-17's `palettes.ts` heuristics — we
 * reuse `mapColorKeyToSlot` so the "primary" color override targets the same
 * conceptual slot a palette click would.
 *
 * Non-goals:
 *  - Multi-color or per-slot override (palettes already cover that on click).
 *  - Persisting the variant (hover-only — releasing the hover restores defaults).
 *
 * Public surface:
 *   - `pickPrimaryColorParameter(parameters)` — chooses the single color param
 *     that the mini "primary color" picker should drive.
 *   - `buildInstantVariantInputProps(template, override)` — builds the
 *     `inputProps` payload for the Remotion <Player>; falls back to defaults
 *     when no override is set.
 *
 * Speed lives on `<Player playbackRate>`, not in PARAMS — non-destructive,
 * works for templates that don't expose a `speed` param.
 */

import type { Parameter, Template } from '@/types';
import { mapColorKeyToSlot } from '@/lib/palettes';

/**
 * Resolve which `color`-typed PARAMS key the hover "primary color" picker
 * should drive. Strategy:
 *
 *   1. Prefer a parameter whose key maps to the `primary` slot (TM-17 heuristic).
 *   2. Otherwise pick the first non-background, non-text color.
 *   3. Otherwise fall back to the first color param.
 *   4. Returns `null` if the template has no color params (mini control is hidden).
 */
export function pickPrimaryColorParameter(parameters: Parameter[]): Parameter | null {
  const colors = parameters.filter(p => p.type === 'color');
  if (colors.length === 0) return null;

  const explicitPrimary = colors.find(p => mapColorKeyToSlot(p.key) === 'primary');
  if (explicitPrimary) return explicitPrimary;

  const nonChrome = colors.find(p => {
    const slot = mapColorKeyToSlot(p.key);
    return slot !== 'background' && slot !== 'text';
  });
  if (nonChrome) return nonChrome;

  return colors[0];
}

/**
 * Build the `inputProps` object passed to <Player>. We always start from the
 * template's defaults so non-overridden params keep their original animation
 * intent — only the keys present in `override` are replaced.
 *
 * Stable identity is the caller's responsibility: wrap the return value in
 * `useMemo` keyed on `[template.id, override.colorKey, override.colorValue]`,
 * otherwise React/Remotion will re-mount the composition on every render and
 * tank gallery FPS.
 */
export function buildInstantVariantInputProps(
  template: Pick<Template, 'parameters'>,
  override?: { colorKey: string; colorValue: string } | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = Object.fromEntries(
    template.parameters.map(p => [p.key, p.value]),
  );
  if (!override) return base;
  // Defensive: only apply if the key actually exists on the template
  // (prevents leaking a stale override when the user moves between templates).
  if (!(override.colorKey in base)) return base;
  return { ...base, [override.colorKey]: override.colorValue };
}

/** Speed presets for the mini control. Centralized so PoC + standardization match. */
export const INSTANT_SPEED_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
];

export const DEFAULT_INSTANT_SPEED = 1;
