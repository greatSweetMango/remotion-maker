/**
 * Theme palettes for one-click bulk color application across PARAMS.
 *
 * Each palette defines five semantic slots (primary / secondary / accent /
 * background / text). At apply-time, every `color`-typed parameter in the
 * current asset is mapped to one of those slots via a name-based heuristic
 * (see `mapColorKeyToSlot`). Unknown keys are filled by cycling through the
 * remaining slots so no color parameter is left unchanged — that's what
 * gives the "one-click visual impact".
 */

import type { Parameter } from '@/types';

export type PaletteSlot = 'primary' | 'secondary' | 'accent' | 'background' | 'text';

export interface Palette {
  id: string;
  name: string;
  /** Hex chip color used for the palette button preview (usually = primary). */
  swatch?: string;
  colors: Record<PaletteSlot, string>;
}

/**
 * 6 curated palettes covering common demo aesthetics.
 * Add/remove freely — `PALETTES` is the single source of truth and is
 * iterated for the chip strip in `CustomizePanel`.
 */
export const PALETTES: Palette[] = [
  {
    id: 'vivid',
    name: 'Vivid',
    colors: {
      primary: '#7C3AED',
      secondary: '#EC4899',
      accent: '#F59E0B',
      background: '#0f0f17',
      text: '#ffffff',
    },
  },
  {
    id: 'pastel',
    name: 'Pastel',
    colors: {
      primary: '#A78BFA',
      secondary: '#FBCFE8',
      accent: '#FDE68A',
      background: '#FAF5FF',
      text: '#1F2937',
    },
  },
  {
    id: 'monochrome',
    name: 'Mono',
    colors: {
      primary: '#FFFFFF',
      secondary: '#9CA3AF',
      accent: '#D1D5DB',
      background: '#0A0A0A',
      text: '#F9FAFB',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colors: {
      primary: '#FF00C8',
      secondary: '#00F0FF',
      accent: '#FFE600',
      background: '#0A0014',
      text: '#F5F5FF',
    },
  },
  {
    id: 'earth',
    name: 'Earth',
    colors: {
      primary: '#B45309',
      secondary: '#65A30D',
      accent: '#D97706',
      background: '#1C1917',
      text: '#FEF3C7',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: {
      primary: '#0EA5E9',
      secondary: '#14B8A6',
      accent: '#22D3EE',
      background: '#0C1E2E',
      text: '#E0F2FE',
    },
  },
];

/**
 * Heuristic: given a PARAMS color key, decide which palette slot it represents.
 * Order matters — we check the most specific patterns first (background/text
 * before generic "color"), since e.g. `backgroundColor` would otherwise match
 * "color" before "background".
 *
 * Returns `null` for ambiguous keys (e.g. `color1`, `strokeColor`,
 * `cursorColor`); callers handle those via fallback cycling so every color
 * parameter still gets recoloured.
 */
export function mapColorKeyToSlot(key: string): PaletteSlot | null {
  const k = key.toLowerCase();

  // Background first — `backgroundColor` contains "color" too.
  if (k.includes('background') || k === 'bg' || k.startsWith('bg')) return 'background';
  // Text/label/foreground share the same slot.
  if (k.includes('text') || k.includes('label') || k.includes('foreground') || k === 'fg') return 'text';
  if (k.includes('primary') || k.includes('main')) return 'primary';
  if (k.includes('secondary')) return 'secondary';
  if (k.includes('accent') || k.includes('highlight')) return 'accent';

  return null;
}

/**
 * Build the bulk update payload for a palette click.
 *
 * Strategy:
 *  1. Each `color`-typed parameter is matched to a slot via `mapColorKeyToSlot`.
 *  2. Unmatched keys are filled by cycling through `PaletteSlot` order
 *     (`primary → secondary → accent → background → text → primary → ...`)
 *     so every color visibly changes — important for demo impact.
 *  3. Non-color parameters are ignored.
 */
export function buildPaletteUpdates(
  parameters: Parameter[],
  palette: Palette,
): Record<string, string> {
  const slotOrder: PaletteSlot[] = ['primary', 'secondary', 'accent', 'background', 'text'];
  const updates: Record<string, string> = {};

  let cycleIdx = 0;
  for (const param of parameters) {
    if (param.type !== 'color') continue;

    const matchedSlot = mapColorKeyToSlot(param.key);
    const slot = matchedSlot ?? slotOrder[cycleIdx % slotOrder.length];
    if (!matchedSlot) cycleIdx += 1;

    updates[param.key] = palette.colors[slot];
  }

  return updates;
}
