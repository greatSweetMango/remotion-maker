/**
 * @jest-environment jsdom
 *
 * TM-99 — PlayerPanel must wire `playbackRate` + `showPlaybackRateControl`
 * into the Remotion `<Player>` and expose a discoverable speed-button UI.
 *
 * Discovered during TM-79 r1 QA: pause/play/seek worked but users had no
 * way to change playback speed. Fix adds [0.5×, 1×, 1.5×, 2×] buttons that
 * drive a controlled `playbackRate` state, plus enables Remotion's built-in
 * rate-control menu via `showPlaybackRateControl`.
 *
 * Strategy: mock `@remotion/player`'s `Player` to a recorder that captures
 * the last received props. Driving the speed buttons in the PlayerPanel
 * toolbar should re-render the Player with a matching `playbackRate`.
 */
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Capture the last props handed to <Player /> for assertions.
const lastPlayerProps: { current: Record<string, unknown> | null } = { current: null };

jest.mock('@remotion/player', () => {
  const React = require('react');
  return {
    __esModule: true,
    Player: React.forwardRef(function MockPlayer(props: Record<string, unknown>, _ref: unknown) {
      lastPlayerProps.current = props;
      return React.createElement('div', { 'data-testid': 'mock-player' });
    }),
  };
});

// Stub the evaluator so PlayerPanel renders the Player branch without
// having to compile real generated code in a jsdom env.
jest.mock('@/lib/remotion/evaluator', () => ({
  evaluateComponentDetailed: () => ({
    component: function StubComp() {
      return null;
    },
    error: null,
  }),
}));

// FPS monitor pulls RAF — short-circuit it.
jest.mock('@/hooks/useFpsMonitor', () => ({
  useFpsMonitor: () => ({ fps: null, isLow: false, sampleCount: 0 }),
}));

import { PlayerPanel } from '@/components/studio/PlayerPanel';
import type { GeneratedAsset } from '@/types';

const ASSET: GeneratedAsset = {
  id: 'tm-99-fixture',
  title: 'TM-99 fixture',
  jsCode: '/* stub */',
  fps: 30,
  durationInFrames: 90,
  width: 1920,
  height: 1080,
  // The rest of the GeneratedAsset shape is permissive in the type; the
  // PlayerPanel only reads the fields above.
} as unknown as GeneratedAsset;

describe('TM-99 PlayerPanel playback-rate controls', () => {
  beforeEach(() => {
    lastPlayerProps.current = null;
  });

  it('forwards playbackRate=1 and a [0.5,1,1.5,2] showPlaybackRateControl array on first render', () => {
    render(<PlayerPanel asset={ASSET} paramValues={{}} isGenerating={false} />);

    const props = lastPlayerProps.current;
    expect(props).not.toBeNull();
    expect(props!.playbackRate).toBe(1);
    expect(props!.showPlaybackRateControl).toEqual([0.5, 1, 1.5, 2]);
  });

  it('renders one button per rate with aria-pressed reflecting the current state', () => {
    render(<PlayerPanel asset={ASSET} paramValues={{}} isGenerating={false} />);
    const group = screen.getByTestId('playback-rate-controls');
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute('aria-label', 'Playback speed');

    for (const rate of [0.5, 1, 1.5, 2]) {
      const btn = screen.getByTestId(`playback-rate-${rate}x`);
      expect(btn).toHaveAttribute('aria-pressed', rate === 1 ? 'true' : 'false');
    }
  });

  it('clicking 2× updates playbackRate prop on the Player and aria-pressed on the button', () => {
    render(<PlayerPanel asset={ASSET} paramValues={{}} isGenerating={false} />);

    act(() => {
      fireEvent.click(screen.getByTestId('playback-rate-2x'));
    });

    expect(lastPlayerProps.current!.playbackRate).toBe(2);
    expect(screen.getByTestId('playback-rate-2x')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('playback-rate-1x')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching from 0.5× back to 1× restores normal speed', () => {
    render(<PlayerPanel asset={ASSET} paramValues={{}} isGenerating={false} />);

    act(() => {
      fireEvent.click(screen.getByTestId('playback-rate-0.5x'));
    });
    expect(lastPlayerProps.current!.playbackRate).toBe(0.5);

    act(() => {
      fireEvent.click(screen.getByTestId('playback-rate-1x'));
    });
    expect(lastPlayerProps.current!.playbackRate).toBe(1);
  });

  it('does not render the speed control group when there is no asset', () => {
    render(<PlayerPanel asset={null} paramValues={{}} isGenerating={false} />);
    expect(screen.queryByTestId('playback-rate-controls')).not.toBeInTheDocument();
  });
});
