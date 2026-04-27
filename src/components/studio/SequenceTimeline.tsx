'use client';
import React from 'react';
import { useActiveSequence } from '@/hooks/useActiveSequence';
import { Layers, Eye } from 'lucide-react';

/**
 * Compact horizontal sequence map shown above CustomizePanel content.
 * - Each segment is a clickable cell sized proportional to its duration.
 * - The currently-active segment glows.
 * - "All" toggle on the right shows every PARAM regardless of segment.
 * - Returns `null` when the asset has no Sequence segments (single-shot template).
 */
export function SequenceTimeline() {
  const {
    segments,
    activeSequenceId,
    isAllMode,
    autoFollow,
    currentFrame,
    seekToSequence,
    toggleAllMode,
    resumeAutoFollow,
  } = useActiveSequence();

  if (segments.length <= 1) return null; // Nothing to navigate.

  const total = segments.reduce((acc, s) => Math.max(acc, s.from + s.durationInFrames), 0);
  const playheadPct = total > 0 ? Math.min(100, Math.max(0, (currentFrame / total) * 100)) : 0;

  return (
    <div className="px-4 pt-3 pb-2 border-b border-slate-700 bg-slate-900/40">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          <Layers className="h-3 w-3" />
          Sequence
          {!autoFollow && !isAllMode && (
            <button
              type="button"
              onClick={resumeAutoFollow}
              className="ml-2 normal-case text-[10px] text-violet-300 hover:text-violet-200 underline"
              title="Resume following the playhead"
            >
              auto
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={toggleAllMode}
          aria-pressed={isAllMode}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
            isAllMode
              ? 'bg-violet-600 border-violet-500 text-white'
              : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-white'
          }`}
          title="Show all parameters (A)"
        >
          <Eye className="h-3 w-3" />
          All
        </button>
      </div>

      <div className="relative">
        <div className="flex w-full h-8 rounded overflow-hidden border border-slate-700 bg-slate-800">
          {segments.map(seg => {
            const isActive = !isAllMode && seg.id === activeSequenceId;
            const widthPct = total > 0 ? (seg.durationInFrames / total) * 100 : 100 / segments.length;
            return (
              <button
                key={seg.id}
                type="button"
                onClick={() => seekToSequence(seg.id)}
                title={`${seg.label} — ${seg.durationInFrames}f`}
                style={{ width: `${widthPct}%` }}
                className={`text-[10px] font-medium px-1 truncate border-r border-slate-700 last:border-r-0 transition-colors ${
                  isActive
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {seg.label}
              </button>
            );
          })}
        </div>

        {/* Playhead indicator */}
        <div
          className="absolute top-0 h-8 w-px bg-amber-300 pointer-events-none"
          style={{ left: `calc(${playheadPct}% - 0.5px)` }}
          aria-hidden
        />
      </div>

      {!isAllMode && (
        <div className="mt-1.5 text-[10px] text-slate-500">
          showing params for{' '}
          <span className="text-slate-300 font-medium">
            {segments.find(s => s.id === activeSequenceId)?.label ?? activeSequenceId}
          </span>
          {autoFollow && <span className="text-violet-400 ml-1">(auto)</span>}
        </div>
      )}
    </div>
  );
}
