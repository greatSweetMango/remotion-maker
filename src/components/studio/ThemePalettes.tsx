'use client';
import React from 'react';
import { Sparkles } from 'lucide-react';
import { PALETTES, buildPaletteUpdates, type Palette } from '@/lib/palettes';
import type { Parameter } from '@/types';

interface ThemePalettesProps {
  parameters: Parameter[];
  onApply: (updates: Record<string, string>) => void;
}

/**
 * One-click theme palette strip rendered atop CustomizePanel when the asset
 * has at least one `color`-typed parameter. Clicking a chip dispatches a
 * batched update of every color key (see `buildPaletteUpdates`).
 */
export function ThemePalettes({ parameters, onApply }: ThemePalettesProps) {
  const hasColors = parameters.some(p => p.type === 'color');
  if (!hasColors) return null;

  const handleApply = (palette: Palette) => {
    const updates = buildPaletteUpdates(parameters, palette);
    onApply(updates);
  };

  return (
    <div data-testid="theme-palettes">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Theme
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PALETTES.map(palette => (
          <button
            key={palette.id}
            type="button"
            onClick={() => handleApply(palette)}
            title={`Apply ${palette.name} palette`}
            className="group flex flex-col items-stretch gap-1 rounded-md border border-slate-700 bg-slate-800/40 p-1.5 hover:border-violet-500 hover:bg-slate-800 transition-colors"
          >
            <div className="flex h-6 w-full overflow-hidden rounded">
              <span className="flex-1" style={{ backgroundColor: palette.colors.primary }} />
              <span className="flex-1" style={{ backgroundColor: palette.colors.secondary }} />
              <span className="flex-1" style={{ backgroundColor: palette.colors.accent }} />
              <span className="flex-1" style={{ backgroundColor: palette.colors.background }} />
              <span className="flex-1" style={{ backgroundColor: palette.colors.text }} />
            </div>
            <span className="text-[10px] font-medium text-slate-400 group-hover:text-white text-center truncate">
              {palette.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
