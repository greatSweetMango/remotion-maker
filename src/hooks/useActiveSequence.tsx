'use client';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PlayerRef } from '@remotion/player';
import {
  ALL_MODE_ID,
  type SequenceSegment,
  activeSequenceAt,
  extractSequences,
} from '@/lib/sequences';

/**
 * Single source of truth for "what sequence is the user editing right now?".
 *
 * Two inputs:
 *   - the Player's current frame (driven by Remotion's `frameupdate` event)
 *   - explicit user selection (clicked timeline marker, hotkey, "All" toggle)
 *
 * `activeSequenceId` resolution:
 *   - If user picked `'all'` → return `'all'` (CustomizePanel shows everything).
 *   - If user picked a specific id → return that id (sticky until they pick another or hit "auto").
 *   - Else (auto-follow mode) → derive from current frame.
 */

interface ActiveSequenceContextValue {
  segments: SequenceSegment[];
  activeSequenceId: string;
  isAllMode: boolean;
  /** True when activeSequenceId is being auto-derived from playback frame. */
  autoFollow: boolean;
  /** Current frame as reported by the Player (or last seek). */
  currentFrame: number;
  setSelectedSequenceId: (id: string | null) => void;
  toggleAllMode: () => void;
  resumeAutoFollow: () => void;
  /** Programmatically jump the Player to a sequence's start frame. */
  seekToSequence: (id: string) => void;
  registerPlayerRef: (ref: PlayerRef | null) => void;
}

const ActiveSequenceContext = createContext<ActiveSequenceContextValue | null>(null);

export interface ActiveSequenceProviderProps {
  /** Source code (TS or transpiled JS) of the active asset; used to extract Sequence segments. */
  source: string | null;
  children: React.ReactNode;
}

export function ActiveSequenceProvider({ source, children }: ActiveSequenceProviderProps) {
  const segments = useMemo<SequenceSegment[]>(
    () => (source ? extractSequences(source) : []),
    [source],
  );

  const playerRefBox = useRef<PlayerRef | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  // `null` → auto-follow; `'all'` → show all params; specific id → sticky.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset transient state when the asset's source changes (different segments
  // entirely — old selection/frame would be meaningless). The
  // "store-prev-prop-in-state" pattern lets us update during render without
  // triggering a cascade — React replays the same render with the new state.
  const [trackedSource, setTrackedSource] = useState<string | null>(source);
  if (trackedSource !== source) {
    setTrackedSource(source);
    setSelectedId(null);
    setCurrentFrame(0);
  }

  const registerPlayerRef = useCallback((ref: PlayerRef | null) => {
    if (playerRefBox.current === ref) return;
    playerRefBox.current = ref;
    if (!ref) return;
    // Initial seed
    try {
      setCurrentFrame(ref.getCurrentFrame());
    } catch {
      // Player may not be fully mounted yet; ignore.
    }
  }, []);

  // Subscribe to frameupdate via a re-run on ref change.
  useEffect(() => {
    const ref = playerRefBox.current;
    if (!ref) return;
    const onFrameUpdate = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };
    // Cast: @remotion/player typings are sound but vary across versions.
    (ref as unknown as { addEventListener: (ev: string, cb: (e: { detail: { frame: number } }) => void) => void })
      .addEventListener('frameupdate', onFrameUpdate);
    return () => {
      (ref as unknown as { removeEventListener: (ev: string, cb: (e: { detail: { frame: number } }) => void) => void })
        .removeEventListener('frameupdate', onFrameUpdate);
    };
    // We re-subscribe whenever the *registered* ref changes. `playerRefBox.current`
    // alone wouldn't trigger the effect, so we hang the dep on `source` (which
    // is what causes the Player — and its ref — to be re-mounted in practice).
  }, [source]);

  const autoActive = activeSequenceAt(segments, currentFrame);
  const autoActiveId = autoActive?.id ?? null;

  const activeSequenceId = selectedId ?? autoActiveId ?? (segments[0]?.id ?? ALL_MODE_ID);
  const isAllMode = activeSequenceId === ALL_MODE_ID;
  const autoFollow = selectedId === null;

  const setSelectedSequenceId = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const toggleAllMode = useCallback(() => {
    setSelectedId(prev => (prev === ALL_MODE_ID ? null : ALL_MODE_ID));
  }, []);

  const resumeAutoFollow = useCallback(() => {
    setSelectedId(null);
  }, []);

  const seekToSequence = useCallback((id: string) => {
    const seg = segments.find(s => s.id === id);
    if (!seg) return;
    setSelectedId(id);
    const ref = playerRefBox.current;
    if (ref) {
      try {
        ref.seekTo(seg.from);
      } catch {
        // best-effort
      }
    }
  }, [segments]);

  const value: ActiveSequenceContextValue = {
    segments,
    activeSequenceId,
    isAllMode,
    autoFollow,
    currentFrame,
    setSelectedSequenceId,
    toggleAllMode,
    resumeAutoFollow,
    seekToSequence,
    registerPlayerRef,
  };

  return (
    <ActiveSequenceContext.Provider value={value}>
      {children}
    </ActiveSequenceContext.Provider>
  );
}

export function useActiveSequence(): ActiveSequenceContextValue {
  const ctx = useContext(ActiveSequenceContext);
  if (!ctx) {
    throw new Error('useActiveSequence must be used inside <ActiveSequenceProvider>');
  }
  return ctx;
}

/**
 * Optional consumer that doesn't throw — returns null when no provider is mounted.
 * Useful for components shared between contexts that may or may not have sequences.
 */
export function useActiveSequenceOptional(): ActiveSequenceContextValue | null {
  return useContext(ActiveSequenceContext);
}
