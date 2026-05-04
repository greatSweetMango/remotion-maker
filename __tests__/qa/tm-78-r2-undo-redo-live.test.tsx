/**
 * @jest-environment jsdom
 *
 * TM-78 r2 — live verification of TM-91's undo/redo wiring.
 *
 * The pure reducer is already covered by `__tests__/hooks/studio-history.test.ts`
 * (8/8 pass). This suite exercises the *live* surface that users actually
 * touch:
 *   1. `useStudio` hook end-to-end — dispatch, paramValues, canUndo/canRedo.
 *   2. Global keydown handler — Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+Y.
 *   3. CustomizePanel UI buttons — clicks must call onUndo/onRedo and respect
 *      disabled state when canUndo/canRedo is false.
 *   4. 50-edit / 50-undo round-trip via the live hook.
 *   5. Branching: edits after undo wipe future.
 *   6. Depth cap: 100 entries max (HISTORY_DEPTH).
 *   7. Memory: dropped past + cleared future are no longer reachable from
 *      the live state object.
 *
 * Note: NextAuth's auto-login route + a pre-existing prisma-on-client build
 * issue (`src/lib/usage.ts` is imported by `PromptPanel.tsx`, transitively
 * pulling `node:fs` into the browser bundle) prevent us from reaching
 * `/studio` via Playwright on Next 16.2.4 / Turbopack right now. That bug
 * predates TM-78 (it sits on origin/main); see retro for follow-up task.
 * The jsdom path below covers the same UX surface.
 */

import React from 'react';
import { act, render, fireEvent, screen, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';

// jsdom polyfills for Radix primitives used by CustomizePanel descendants.
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

import { useStudio, HISTORY_DEPTH } from '@/hooks/useStudio';
import { CustomizePanel } from '@/components/studio/CustomizePanel';
import type { Parameter, Template } from '@/types';

const template: Template = {
  id: 'tm78-fixture',
  title: 'tm78-fixture',
  description: 'fixture',
  category: 'other',
  thumbnail: '',
  code: '/* tsx */',
  jsCode: '/* js */',
  parameters: [
    { key: 'opacity', label: 'Opacity', group: 'other', type: 'range', value: 0, min: 0, max: 200, step: 1 },
  ],
  durationInFrames: 60,
  fps: 30,
  width: 1920,
  height: 1080,
} as unknown as Template;

function bootstrapHook() {
  const r = renderHook(() => useStudio());
  act(() => {
    r.result.current.initTemplate(template);
  });
  return r;
}

function pressKey(opts: { key: string; meta?: boolean; ctrl?: boolean; shift?: boolean }) {
  const e = new KeyboardEvent('keydown', {
    key: opts.key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(e);
}

describe('TM-78 r2 — useStudio undo/redo live verification', () => {
  it('canUndo flips false→true after first edit, true→false after one undo', () => {
    const { result } = bootstrapHook();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.updateParam('opacity', 5));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.state.paramValues.opacity).toBe(0);
  });

  it('Cmd+Z triggers undo, Cmd+Shift+Z and Cmd+Y trigger redo', () => {
    const { result } = bootstrapHook();
    act(() => result.current.updateParam('opacity', 11));
    act(() => result.current.updateParam('opacity', 22));
    expect(result.current.state.paramValues.opacity).toBe(22);

    act(() => pressKey({ key: 'z', meta: true }));
    expect(result.current.state.paramValues.opacity).toBe(11);

    act(() => pressKey({ key: 'z', meta: true, shift: true }));
    expect(result.current.state.paramValues.opacity).toBe(22);

    act(() => pressKey({ key: 'z', meta: true }));
    expect(result.current.state.paramValues.opacity).toBe(11);

    act(() => pressKey({ key: 'y', meta: true }));
    expect(result.current.state.paramValues.opacity).toBe(22);

    // Cross-platform: Ctrl+Z works on win/linux semantics.
    act(() => result.current.updateParam('opacity', 33));
    act(() => pressKey({ key: 'z', ctrl: true }));
    expect(result.current.state.paramValues.opacity).toBe(22);
  });

  it('keyboard handler skips when focus is in an editable field', () => {
    const { result } = bootstrapHook();
    act(() => result.current.updateParam('opacity', 5));
    expect(result.current.state.paramValues.opacity).toBe(5);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const e = new KeyboardEvent('keydown', {
      key: 'z', metaKey: true, bubbles: true, cancelable: true,
    });
    Object.defineProperty(e, 'target', { value: input });
    act(() => { window.dispatchEvent(e); });

    // No undo applied — value still 5.
    expect(result.current.state.paramValues.opacity).toBe(5);
    document.body.removeChild(input);
  });

  it('50 edits → 50 Cmd+Z → original value', () => {
    const { result } = bootstrapHook();
    act(() => {
      for (let i = 1; i <= 50; i++) result.current.updateParam('opacity', i);
    });
    expect(result.current.state.paramValues.opacity).toBe(50);
    expect(result.current.state.history.past.length).toBe(50);

    act(() => {
      for (let i = 0; i < 50; i++) pressKey({ key: 'z', meta: true });
    });
    expect(result.current.state.paramValues.opacity).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.state.history.future.length).toBe(50);
  });

  it('branch: 30 edits → 10 undo → new edit clears future, redo blocked', () => {
    const { result } = bootstrapHook();
    act(() => {
      for (let i = 1; i <= 30; i++) result.current.updateParam('opacity', i);
    });
    act(() => {
      for (let i = 0; i < 10; i++) pressKey({ key: 'z', meta: true });
    });
    expect(result.current.state.paramValues.opacity).toBe(20);
    expect(result.current.state.history.future.length).toBe(10);

    act(() => result.current.updateParam('opacity', 999));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.state.history.future.length).toBe(0);

    // Cmd+Shift+Z is now a no-op — value stays at 999.
    act(() => pressKey({ key: 'z', meta: true, shift: true }));
    expect(result.current.state.paramValues.opacity).toBe(999);
  });

  it(`enforces depth cap of ${HISTORY_DEPTH} via live hook`, () => {
    const { result } = bootstrapHook();
    act(() => {
      for (let i = 1; i <= 150; i++) result.current.updateParam('opacity', i);
    });
    expect(result.current.state.history.past.length).toBe(HISTORY_DEPTH);
    expect(result.current.state.paramValues.opacity).toBe(150);

    // 100 undos lands at value 50 (oldest 50 snapshots dropped).
    act(() => {
      for (let i = 0; i < HISTORY_DEPTH; i++) pressKey({ key: 'z', meta: true });
    });
    expect(result.current.state.paramValues.opacity).toBe(50);
    expect(result.current.canUndo).toBe(false);
  });

  it('memory: dropped past + cleared future not reachable from state', () => {
    const { result } = bootstrapHook();
    // Identity-tagged objects let us assert references are gone.
    const sentinels: Record<string, unknown>[] = [];

    act(() => {
      for (let i = 1; i <= 150; i++) {
        result.current.updateParam('opacity', i);
        sentinels.push(result.current.state.paramValues);
      }
    });

    const reachableInPast = new Set(result.current.state.history.past);
    // First 50 snapshots must have been evicted.
    let evicted = 0;
    for (let i = 0; i < 50; i++) {
      if (!reachableInPast.has(sentinels[i] as never)) evicted++;
    }
    expect(evicted).toBe(50);

    // Branch test: undo 20, then new edit — future array must be a fresh empty.
    act(() => {
      for (let i = 0; i < 20; i++) pressKey({ key: 'z', meta: true });
    });
    const futureRef = result.current.state.history.future;
    expect(futureRef.length).toBe(20);
    act(() => result.current.updateParam('opacity', -1));
    expect(result.current.state.history.future).not.toBe(futureRef);
    expect(result.current.state.history.future.length).toBe(0);
  });
});

describe('TM-78 r2 — CustomizePanel undo/redo button wiring', () => {
  function renderPanel(overrides: Partial<{
    canUndo: boolean; canRedo: boolean;
    onUndo: () => void; onRedo: () => void;
  }> = {}) {
    const onUndo = overrides.onUndo ?? jest.fn();
    const onRedo = overrides.onRedo ?? jest.fn();
    const params: Parameter[] = [
      { key: 'opacity', label: 'Opacity', group: 'other', type: 'range', value: 5, min: 0, max: 100, step: 1 },
    ];
    render(
      <CustomizePanel
        parameters={params}
        paramValues={{ opacity: 5 }}
        onParamChange={() => {}}
        tier={'FREE' as const}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={overrides.canUndo ?? true}
        canRedo={overrides.canRedo ?? true}
      />
    );
    return { onUndo, onRedo };
  }

  it('clicking Undo / Redo calls handlers', () => {
    const { onUndo, onRedo } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('Undo button is disabled when canUndo=false; Redo when canRedo=false', () => {
    renderPanel({ canUndo: false, canRedo: false });
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
  });

  it('exposes Cmd+Z / Cmd+Shift+Z hints via title attribute', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /^undo$/i })).toHaveAttribute('title', 'Undo (Cmd+Z)');
    expect(screen.getByRole('button', { name: /^redo$/i })).toHaveAttribute('title', 'Redo (Cmd+Shift+Z)');
  });
});
