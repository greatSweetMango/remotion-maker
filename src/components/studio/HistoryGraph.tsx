'use client';
import React, { useMemo, useState } from 'react';
import type { AssetVersion } from '@/types';
import { Badge } from '@/components/ui/badge';

/**
 * HistoryGraph — TM-24
 *
 * Renders the version history as a branching SVG tree (Figma-style).
 *
 * Layout algorithm (no external deps):
 *  1. Build a parent → children adjacency map. Versions without `parentId`
 *     fall back to the linear-chain heuristic (parent = previous index in
 *     `versions`) so legacy data still renders sensibly.
 *  2. DFS from each root. Each node gets:
 *       - `row` = its generation depth
 *       - `col` = the first child of a parent inherits its column; subsequent
 *         children allocate `nextCol++`. This produces a Figma-like layout
 *         where the "main line" stays vertical and forks appear to the right.
 *  3. Render with SVG. Edges are simple polylines (parent down, then bend
 *     to child column). Nodes are circles + side label.
 *
 * Click → restore that version.
 * Hover → tooltip with prompt + timestamp.
 *
 * Mobile: SVG width is computed from `nextCol`, the wrapping div is
 * `overflow-x-auto` so wide trees become horizontally scrollable.
 */

interface HistoryGraphProps {
  versions: AssetVersion[];
  currentVersionIndex: number;
  onRestoreVersion: (index: number) => void;
}

interface LaidOutNode {
  index: number;
  version: AssetVersion;
  row: number;
  col: number;
  parentRow: number | null;
  parentCol: number | null;
}

const NODE_R = 8;
const COL_W = 36;
const ROW_H = 44;
const PAD_X = 20;
const PAD_Y = 16;

/** Compute (row, col) for each version. Exported for unit tests. */
export function layoutVersions(versions: AssetVersion[]): LaidOutNode[] {
  if (versions.length === 0) return [];

  const idToIndex = new Map<string, number>();
  versions.forEach((v, i) => idToIndex.set(v.id, i));

  // Determine parent index for each version.
  const parentIndex: (number | null)[] = versions.map((v, i) => {
    if (v.parentId === null) return null;
    if (v.parentId !== undefined) {
      const p = idToIndex.get(v.parentId);
      return p !== undefined ? p : null;
    }
    // Legacy: no parentId field → linear chain.
    return i === 0 ? null : i - 1;
  });

  const childrenOf: number[][] = versions.map(() => []);
  parentIndex.forEach((p, i) => {
    if (p !== null) childrenOf[p].push(i);
  });

  const nodes: LaidOutNode[] = versions.map((v, i) => ({
    index: i,
    version: v,
    row: -1,
    col: -1,
    parentRow: null,
    parentCol: null,
  }));

  let nextCol = 0;

  const visit = (i: number, row: number, inheritedCol: number | null) => {
    const col = inheritedCol ?? nextCol++;
    nodes[i].row = row;
    nodes[i].col = col;

    const kids = childrenOf[i];
    kids.forEach((k, idx) => {
      // First child stays in same column (the "trunk"); rest fork right.
      const childCol = idx === 0 ? col : null;
      visit(k, row + 1, childCol);
    });
  };

  parentIndex.forEach((p, i) => {
    if (p === null) {
      visit(i, 0, null);
    }
  });

  // Wire parent coords for edge rendering.
  parentIndex.forEach((p, i) => {
    if (p !== null) {
      nodes[i].parentRow = nodes[p].row;
      nodes[i].parentCol = nodes[p].col;
    }
  });

  return nodes;
}

export const HistoryGraph: React.FC<HistoryGraphProps> = ({
  versions,
  currentVersionIndex,
  onRestoreVersion,
}) => {
  const nodes = useMemo(() => layoutVersions(versions), [versions]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (nodes.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-slate-500" data-testid="history-graph-empty">
        No history yet.
      </div>
    );
  }

  const maxRow = Math.max(...nodes.map((n) => n.row));
  const maxCol = Math.max(...nodes.map((n) => n.col));

  const width = PAD_X * 2 + (maxCol + 1) * COL_W;
  const height = PAD_Y * 2 + (maxRow + 1) * ROW_H;

  const xOf = (col: number) => PAD_X + col * COL_W + COL_W / 2;
  const yOf = (row: number) => PAD_Y + row * ROW_H + ROW_H / 2;

  return (
    <div
      className="overflow-x-auto overflow-y-auto max-h-72 px-2 py-2"
      data-testid="history-graph"
      role="tree"
      aria-label="Version history graph"
    >
      <svg
        width={width}
        height={height}
        className="block"
        // Allow labels (rendered as <foreignObject>) to extend right of the
        // last column — actual text width is unknown ahead of time.
        style={{ minWidth: width, minHeight: height }}
      >
        {/* Edges */}
        {nodes.map((n) => {
          if (n.parentRow === null || n.parentCol === null) return null;
          const x1 = xOf(n.parentCol);
          const y1 = yOf(n.parentRow);
          const x2 = xOf(n.col);
          const y2 = yOf(n.row);
          // Bend: drop straight from parent, then horizontal to child column.
          const midY = y2 - ROW_H / 2;
          const path =
            n.col === n.parentCol
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
          return (
            <path
              key={`edge-${n.index}`}
              d={path}
              stroke="rgb(71, 85, 105)" // slate-600
              strokeWidth={1.5}
              fill="none"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const isCurrent = n.index === currentVersionIndex;
          const isHover = n.index === hoverIdx;
          const cx = xOf(n.col);
          const cy = yOf(n.row);
          return (
            <g
              key={`node-${n.index}`}
              role="treeitem"
              aria-selected={isCurrent}
              aria-label={`Version ${n.index + 1}: ${n.version.prompt}`}
              tabIndex={0}
              onClick={() => onRestoreVersion(n.index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRestoreVersion(n.index);
                }
              }}
              onMouseEnter={() => setHoverIdx(n.index)}
              onMouseLeave={() => setHoverIdx((h) => (h === n.index ? null : h))}
              onFocus={() => setHoverIdx(n.index)}
              onBlur={() => setHoverIdx((h) => (h === n.index ? null : h))}
              style={{ cursor: 'pointer' }}
              data-testid={`history-graph-node-${n.index}`}
              data-current={isCurrent ? 'true' : 'false'}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isCurrent ? NODE_R + 2 : NODE_R}
                fill={isCurrent ? 'rgb(139, 92, 246)' : 'rgb(30, 41, 59)'} // violet-500 / slate-800
                stroke={isCurrent ? 'rgb(196, 181, 253)' : 'rgb(100, 116, 139)'} // violet-300 / slate-500
                strokeWidth={2}
              />
              <text
                x={cx + NODE_R + 8}
                y={cy + 4}
                fontSize={11}
                fill={isCurrent ? 'rgb(196, 181, 253)' : 'rgb(148, 163, 184)'} // violet-300 / slate-400
                style={{ pointerEvents: 'none' }}
              >
                v{n.index + 1}
              </text>

              {/* Hover tooltip */}
              {isHover && (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={cx + NODE_R + 4}
                    y={cy - ROW_H / 2 + 2}
                    width={Math.min(220, Math.max(140, n.version.prompt.length * 6))}
                    height={ROW_H - 4}
                    rx={4}
                    fill="rgb(15, 23, 42)" // slate-900
                    stroke="rgb(71, 85, 105)"
                    strokeWidth={1}
                    opacity={0.97}
                  />
                  <text
                    x={cx + NODE_R + 12}
                    y={cy - 4}
                    fontSize={10}
                    fill="rgb(226, 232, 240)" // slate-200
                  >
                    {n.version.prompt.length > 32
                      ? n.version.prompt.slice(0, 32) + '…'
                      : n.version.prompt}
                  </text>
                  <text
                    x={cx + NODE_R + 12}
                    y={cy + 10}
                    fontSize={9}
                    fill="rgb(148, 163, 184)" // slate-400
                  >
                    {formatTimestamp(n.version.createdAt)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {currentVersionIndex >= 0 && nodes[currentVersionIndex] && (
        <div className="mt-1 px-2 text-[10px] text-slate-500 flex items-center gap-2">
          <Badge className="bg-violet-600 text-[10px] py-0">current</Badge>
          <span className="truncate">{nodes[currentVersionIndex].version.prompt}</span>
        </div>
      )}
    </div>
  );
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default HistoryGraph;
