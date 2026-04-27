'use client';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Zap } from 'lucide-react';
import type { Template } from '@/types';
import {
  pickPrimaryColorParameter,
  buildInstantVariantInputProps,
  INSTANT_SPEED_PRESETS,
  DEFAULT_INSTANT_SPEED,
} from '@/lib/instant-variant';
import { FilterBar, type Category } from '@/components/gallery/FilterBar';

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (template: Template) => void;
}

const CATEGORY_GRADIENT: Record<string, string> = {
  counter: 'from-violet-900/60 to-slate-900',
  text: 'from-pink-900/60 to-slate-900',
  chart: 'from-blue-900/60 to-slate-900',
  background: 'from-emerald-900/60 to-slate-900',
  logo: 'from-amber-900/60 to-slate-900',
  composition: 'from-fuchsia-900/60 to-slate-900',
};

/**
 * Hover-intent delay (ms) before the mini variant strip appears.
 * Tuned to feel snappy without flashing on cursor fly-throughs.
 */
const HOVER_INTENT_MS = 180;
/** Long-press threshold for touch devices (ms). */
const LONG_PRESS_MS = 500;

function TemplateThumb({ template, onSelect }: { template: Template; onSelect: () => void }) {
  const Component = evaluateComponent(template.jsCode);
  const gradient = CATEGORY_GRADIENT[template.category] ?? 'from-slate-800 to-slate-900';
  const midFrame = Math.floor(template.durationInFrames * 0.45);

  // Resolve the single color param the hover picker should drive (or null).
  const primaryColorParam = useMemo(
    () => pickPrimaryColorParameter(template.parameters),
    [template.parameters],
  );

  // Hover state — also true on touch long-press.
  const [active, setActive] = useState(false);
  // Mini-control state. Color undefined means "use template default".
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_INSTANT_SPEED);

  // Hover-intent + long-press timers. Refs avoid re-render churn.
  const hoverTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const onMouseEnter = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setActive(true), HOVER_INTENT_MS);
  }, []);

  const onMouseLeave = useCallback(() => {
    clearTimers();
    setActive(false);
    // Reset overrides on hover-out — instant variant is exploratory, not sticky.
    setColorOverride(null);
    setSpeed(DEFAULT_INSTANT_SPEED);
  }, [clearTimers]);

  const onTouchStart = useCallback(() => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => setActive(true), LONG_PRESS_MS);
  }, []);

  const onTouchEnd = useCallback(() => {
    clearTimers();
    // On touch we keep the panel open until the user taps outside the controls;
    // a tap on the thumbnail (not on a control) commits via onSelect, which the
    // parent <button> already handles.
  }, [clearTimers]);

  // Stable inputProps — without memoization the Player would remount each render.
  const override = colorOverride && primaryColorParam
    ? { colorKey: primaryColorParam.key, colorValue: colorOverride }
    : null;
  const inputProps = useMemo(
    () => buildInstantVariantInputProps(template, override),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep value comparison via primitives
    [template, override?.colorKey, override?.colorValue],
  );

  // Keep focus from bubbling thumbnail-click when user interacts with mini controls.
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  return (
    <div
      className="group relative w-full bg-slate-800/50 border border-slate-700 hover:border-violet-500 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-violet-900/20"
      style={{ minWidth: 0 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left"
        style={{ display: 'block' }}
        aria-label={`Open ${template.title}`}
      >
        <div
          className={`aspect-video bg-gradient-to-br ${gradient} relative`}
          style={{ overflow: 'hidden', contain: 'strict' }}
        >
          {Component ? (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              <Player
                component={Component as React.ComponentType<Record<string, unknown>>}
                inputProps={inputProps}
                durationInFrames={template.durationInFrames}
                fps={template.fps}
                compositionWidth={template.width}
                compositionHeight={template.height}
                style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                initialFrame={midFrame}
                playbackRate={speed}
                autoPlay
                loop
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <Sparkles className="h-6 w-6 text-slate-600" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
        </div>
        <div className="p-3">
          <div className="flex items-start justify-between gap-1">
            <span className="text-white text-sm font-semibold leading-tight">{template.title}</span>
            <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-500 capitalize flex-shrink-0">
              {template.category}
            </Badge>
          </div>
          <p className="text-slate-500 text-xs mt-0.5 leading-snug">{template.description}</p>
        </div>
      </button>

      {/*
        Mini instant-variant control strip — overlays the bottom of the thumbnail.
        Hidden until hover-intent fires. Pointer events captured so the parent
        button doesn't receive the click.
      */}
      {active && (
        <div
          onClick={stop}
          onMouseDown={stop}
          onTouchStart={stop}
          className="absolute left-2 right-2 bottom-14 flex items-center gap-2 rounded-lg bg-slate-950/85 backdrop-blur px-2 py-1.5 border border-slate-700 shadow-lg"
          role="group"
          aria-label="Instant variant controls"
        >
          {primaryColorParam && (
            <label
              className="flex items-center gap-1 text-[10px] text-slate-400"
              title={`Primary color (${primaryColorParam.key})`}
            >
              <span className="uppercase tracking-wide">Color</span>
              <input
                type="color"
                value={colorOverride ?? String(primaryColorParam.value)}
                onChange={(e) => setColorOverride(e.target.value)}
                onClick={stop}
                className="h-5 w-6 rounded border border-slate-600 bg-transparent cursor-pointer p-0"
                aria-label="Primary color"
              />
            </label>
          )}
          <div className="flex items-center gap-0.5 ml-auto">
            <Zap className="h-3 w-3 text-slate-500" aria-hidden />
            {INSTANT_SPEED_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                onClick={(e) => { stop(e); setSpeed(preset.value); }}
                className={
                  'text-[10px] px-1.5 py-0.5 rounded ' +
                  (speed === preset.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
                }
                aria-pressed={speed === preset.value}
                aria-label={`Speed ${preset.label}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TemplatePicker({ templates, onSelect }: TemplatePickerProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('all');

  const filtered = useMemo(
    () =>
      activeCategory === 'all'
        ? templates
        : templates.filter(t => t.category === activeCategory),
    [templates, activeCategory],
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden', minWidth: 0 }}>
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <h2 className="text-white font-semibold text-sm mb-0.5">Choose a template</h2>
        <p className="text-slate-500 text-xs">Hover to tweak color and speed instantly · click to open</p>
      </div>
      <div className="px-5 pb-3 flex-shrink-0">
        <FilterBar active={activeCategory} onChange={setActiveCategory} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 16px 16px' }}>
        {filtered.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
            {filtered.map(t => (
              <div key={t.id} style={{ minWidth: 0, overflow: 'hidden' }}>
                <TemplateThumb template={t} onSelect={() => onSelect(t)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500 text-sm">
            No templates in this category yet
          </div>
        )}
      </div>
    </div>
  );
}
