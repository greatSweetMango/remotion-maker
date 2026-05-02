/**
 * @jest-environment jsdom
 *
 * TM-94 — color-contrast residual fix (TM-80 r2 leftover).
 *
 * TM-80 r2 audit (`wiki/05-reports/2026-04-27-TM-80-qa-r2.md`) reported 40
 * serious `color-contrast` violations, all anchored at the prompt-mode chip in
 * `PromptPanel.tsx` (5 templates × 5 nodes = 25 + customize base 12 + home 2 +
 * login 1). 30 / 40 trace back to a single token: `bg-violet-600` chip with a
 * `text-[10px] opacity-60` `<kbd>` shortcut hint.
 *
 * Fix: bump active chip background one notch (violet/emerald 600 → 700) for AA
 * margin, and replace `opacity-60` on the `<kbd>` with explicit `text-white`
 * (active) or `text-slate-300` (inactive) so contrast does not depend on alpha
 * blending against an unknown parent.
 *
 * These tests assert:
 *   1. jest-axe finds no violations on the rendered chip (with hasAsset=true).
 *   2. The active chip uses the bumped 700-shade background.
 *   3. The `<kbd>` hint uses an explicit text color (not `opacity-60`).
 *   4. Static WCAG 2 contrast ratios for the chosen token pairs are >= 4.5.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { PromptPanel } from '@/components/studio/PromptPanel';

expect.extend(toHaveNoViolations);

// Radix UI primitives need these jsdom polyfills.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

// --- WCAG 2.x relative luminance / contrast helpers (no deps) ----------------
function srgbChannel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}
function contrast(fg: string, bg: string) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// Tailwind v4 default palette samples we rely on (locked here so the test
// catches accidental palette swaps).
const TOKENS = {
  white: '#ffffff',
  'violet-600': '#7c3aed',
  'violet-700': '#6d28d9',
  'emerald-600': '#059669',
  'emerald-700': '#047857',
  'slate-300': '#cbd5e1',
  'slate-800': '#1e293b',
};

function renderWithAsset() {
  return render(
    <PromptPanel
      onGenerate={() => {}}
      onEdit={() => {}}
      versions={[{ id: 'v1', code: 'export const PARAMS = {}; export default () => null;', prompt: 'p', createdAt: Date.now() } as never]}
      currentVersionIndex={0}
      onRestoreVersion={() => {}}
      isGenerating={false}
      isEditing={false}
      hasAsset={true}
      tier={'FREE' as never}
    />,
  );
}

describe('TM-94 — Prompt-mode chip color contrast', () => {
  it('renders the chip radiogroup when hasAsset=true', () => {
    renderWithAsset();
    expect(screen.getByRole('radiogroup', { name: /prompt mode/i })).toBeInTheDocument();
  });

  it('has zero jest-axe violations on the chip region', async () => {
    const { container } = renderWithAsset();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('active edit chip uses bumped violet-700 background (not violet-600)', () => {
    renderWithAsset();
    const editChip = screen.getByRole('radio', { name: /edit current/i });
    // checked by default when hasAsset=true.
    expect(editChip.getAttribute('aria-checked')).toBe('true');
    expect(editChip.className).toMatch(/\bbg-violet-700\b/);
    expect(editChip.className).not.toMatch(/\bbg-violet-600\b/);
  });

  it('generate chip becomes emerald-700 (not emerald-600) when activated', () => {
    renderWithAsset();
    const genChip = screen.getByRole('radio', { name: /generate new/i });
    fireEvent.click(genChip);
    expect(genChip.getAttribute('aria-checked')).toBe('true');
    expect(genChip.className).toMatch(/\bbg-emerald-700\b/);
    expect(genChip.className).not.toMatch(/\bbg-emerald-600\b/);
  });

  it('<kbd> shortcut hint uses an explicit text color (not opacity-60)', () => {
    renderWithAsset();
    const kbds = Array.from(document.querySelectorAll('kbd'));
    expect(kbds.length).toBeGreaterThan(0);
    for (const k of kbds) {
      expect(k.className).not.toMatch(/\bopacity-60\b/);
      // Either text-white (when chip active) or text-slate-300 (inactive).
      expect(k.className).toMatch(/text-(white|slate-300)/);
    }
  });

  it('white-on-violet-700 satisfies WCAG AA (>= 4.5)', () => {
    const ratio = contrast(TOKENS.white, TOKENS['violet-700']);
    // violet-700 is darker than violet-600 → strictly higher ratio.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('white-on-emerald-700 satisfies WCAG AA (>= 4.5)', () => {
    const ratio = contrast(TOKENS.white, TOKENS['emerald-700']);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('slate-300-on-slate-800 (inactive chip kbd) satisfies WCAG AA (>= 4.5)', () => {
    const ratio = contrast(TOKENS['slate-300'], TOKENS['slate-800']);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
