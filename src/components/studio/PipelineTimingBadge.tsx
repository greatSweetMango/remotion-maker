'use client';
/**
 * TM-124 — Pipeline timing dev badge.
 *
 * Renders a compact, always-on (but unobtrusive) HUD in the studio that
 * shows whether the last /api/generate run actually took the multi-step
 * pipeline, the per-stage wall-clock breakdown, and whether asset-gen
 * fired. The user reported "생성도 너무 빨리 된 거 아닌가" — this badge
 * exists to prove (or disprove) that suspicion at a glance.
 *
 * Click to expand the stage list. Hidden when there's no timing trace
 * yet (initial template-bootstrap render).
 */
import React, { useState } from 'react';
import type { PipelineTiming } from '@/types';

interface Props {
  timing: PipelineTiming | null;
}

export function PipelineTimingBadge({ timing }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!timing) return null;

  const isMulti = timing.mode === 'multi-step';
  const totalSec = (timing.totalMs / 1000).toFixed(2);
  const dot = isMulti ? 'bg-violet-400' : 'bg-amber-400';
  const label = isMulti ? `multi-step (${timing.scenes} scenes)` : 'single-shot';

  return (
    <div
      className="fixed bottom-3 right-3 z-50 text-[11px] font-mono select-none"
      data-testid="pipeline-timing-badge"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-slate-200 shadow-lg backdrop-blur hover:bg-slate-800"
        title="Click to expand pipeline timing breakdown"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
        <span className="font-semibold">{label}</span>
        <span className="text-slate-400">{totalSec}s</span>
        {timing.asset_gen_used ? (
          <span className="rounded bg-emerald-900/50 px-1 text-emerald-300">img</span>
        ) : null}
      </button>
      {expanded ? (
        <div className="mt-1 rounded-md border border-slate-700 bg-slate-900/95 p-2 shadow-lg backdrop-blur max-w-xs">
          <div className="mb-1 text-slate-400">
            mode={timing.mode} total={timing.totalMs}ms scenes={timing.scenes}
          </div>
          <ul className="space-y-0.5">
            {timing.stages.map((s, i) => (
              <li key={i} className="flex justify-between gap-2 text-slate-300">
                <span className="text-slate-400">{s.name}</span>
                <span>{s.ms}ms</span>
              </li>
            ))}
          </ul>
          {timing.stages.some((s) => s.meta) ? (
            <details className="mt-1 text-slate-500">
              <summary className="cursor-pointer">meta</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">
                {JSON.stringify(
                  timing.stages.map((s) => ({ name: s.name, meta: s.meta })).filter((s) => s.meta),
                  null,
                  1,
                )}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
