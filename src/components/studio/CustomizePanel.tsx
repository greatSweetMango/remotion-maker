'use client';
import React, { useMemo } from 'react';
import { ParameterControl } from './ParameterControl';
import { ThemePalettes } from './ThemePalettes';
import { SequenceTimeline } from './SequenceTimeline';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Palette, Ruler, Clock, Type, Settings2 } from 'lucide-react';
import type { Parameter, Tier } from '@/types';
import Link from 'next/link';
import { useActiveSequenceOptional } from '@/hooks/useActiveSequence';
import { ALL_MODE_ID, filterParamsForSequence } from '@/lib/sequences';

interface CustomizePanelProps {
  parameters: Parameter[];
  paramValues: Record<string, string | number | boolean>;
  onParamChange: (key: string, value: string | number | boolean) => void;
  tier: Tier;
}

const GROUP_META = {
  color:  { label: 'Colors',    Icon: Palette },
  size:   { label: 'Size',      Icon: Ruler },
  timing: { label: 'Timing',    Icon: Clock },
  text:   { label: 'Text',      Icon: Type },
  other:  { label: 'Settings',  Icon: Settings2 },
} as const;

const GROUP_ORDER: Parameter['group'][] = ['color', 'size', 'timing', 'text', 'other'];
const FREE_PARAM_LIMIT = 3;

export function CustomizePanel({ parameters, paramValues, onParamChange, tier }: CustomizePanelProps) {
  const sequenceCtx = useActiveSequenceOptional();
  const segments = sequenceCtx?.segments;
  const activeSequenceId = sequenceCtx?.activeSequenceId ?? ALL_MODE_ID;

  // Apply sequence-aware filter. With <2 sequences or no provider, returns the
  // full list (degenerate case — single-shot template, no filtering needed).
  const visibleParams = useMemo(
    () =>
      segments && segments.length > 1
        ? filterParamsForSequence(parameters, segments, activeSequenceId)
        : parameters,
    [parameters, segments, activeSequenceId],
  );

  if (parameters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-2">
        <Settings2 className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400 text-sm">Generate an animation to see customization options</p>
      </div>
    );
  }

  const groupedParams: Record<string, Parameter[]> = {};
  for (const g of GROUP_ORDER) groupedParams[g] = [];
  for (const p of visibleParams) groupedParams[p.group].push(p);

  let shownSoFar = 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <span className="text-sm font-semibold text-white">Customize</span>
        <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
          {visibleParams.length === parameters.length
            ? `${parameters.length} params`
            : `${visibleParams.length}/${parameters.length} params`}
        </Badge>
      </div>

      <SequenceTimelineSlot />

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <ThemePalettes
          parameters={parameters}
          onApply={updates => {
            for (const [key, value] of Object.entries(updates)) {
              onParamChange(key, value);
            }
          }}
        />

        {visibleParams.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-xs">
            No parameters defined for this sequence. Toggle <span className="text-violet-300">All</span> above to see every parameter.
          </div>
        )}

        {GROUP_ORDER.map(group => {
          const groupParams = groupedParams[group];
          if (!groupParams?.length) return null;

          const { label, Icon } = GROUP_META[group];

          return (
            <div key={group}>
              <div className="flex items-center gap-2 mb-3">
                <Icon className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
              </div>
              <div className="space-y-4">
                {groupParams.map(param => {
                  const isLocked = tier === 'FREE' && shownSoFar >= FREE_PARAM_LIMIT;
                  shownSoFar++;
                  return (
                    <ParameterControl
                      key={param.key}
                      param={param}
                      value={paramValues[param.key] ?? param.value}
                      onChange={val => onParamChange(param.key, val)}
                      locked={isLocked}
                    />
                  );
                })}
              </div>
              <Separator className="mt-4 bg-slate-700/50" />
            </div>
          );
        })}
      </div>

      {tier === 'FREE' && visibleParams.length > FREE_PARAM_LIMIT && (
        <div className="p-4 border-t border-slate-700 bg-slate-800/50">
          <p className="text-xs text-slate-400 mb-2">
            {visibleParams.length - FREE_PARAM_LIMIT} parameters locked on Free plan
          </p>
          <Button asChild size="sm" className="w-full bg-violet-600 hover:bg-violet-700 text-xs">
            <Link href="/pricing">Unlock all with Pro →</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Wrapper that renders <SequenceTimeline> only when an ActiveSequenceProvider
 * is mounted in the tree (so CustomizePanel still works in isolation, e.g.
 * single-template tests or the legacy mobile layout without sequence context).
 */
function SequenceTimelineSlot() {
  const ctx = useActiveSequenceOptional();
  if (!ctx) return null;
  return <SequenceTimeline />;
}
