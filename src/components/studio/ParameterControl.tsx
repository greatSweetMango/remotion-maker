'use client';
import React, { useMemo, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { searchLucideCatalog, DEFAULT_LUCIDE_ICON } from '@/lib/lucide-catalog';
import type { Parameter } from '@/types';

type LucideIconComponent = React.ComponentType<{ size?: number | string; className?: string }>;
type LucideMap = Record<string, LucideIconComponent>;
const LucideMap = LucideIcons as unknown as LucideMap;

function resolveLucideIcon(name: string): LucideIconComponent {
  return LucideMap[name] ?? LucideMap[DEFAULT_LUCIDE_ICON] ?? LucideIcons.Star;
}

interface ParameterControlProps {
  param: Parameter;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  locked?: boolean;
}

export function ParameterControl({ param, value, onChange, locked }: ParameterControlProps) {
  if (locked) {
    return (
      <div className="opacity-50 pointer-events-none relative">
        <ControlContent param={param} value={value} onChange={onChange} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs bg-violet-900/90 text-violet-200 px-2 py-0.5 rounded-full">Pro</span>
        </div>
      </div>
    );
  }

  return <ControlContent param={param} value={value} onChange={onChange} />;
}

/**
 * Clamp a numeric value to the param's [min, max] range. Returns 0 (or `min`
 * if defined) for non-finite inputs — the LLM-emitted PARAMS spec drives the
 * range, so falling back to a defined min preserves valid component props.
 *
 * TM-44: prevents NaN / negative-when-min-is-0 / out-of-range values from
 * propagating to Player `inputProps`, which would make Remotion components
 * render garbage frames or throw.
 */
function clampNumber(n: unknown, min?: number, max?: number): number {
  const fallback = typeof min === 'number' ? min : 0;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  let v = n;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  return v;
}

/**
 * Allow only #RGB / #RRGGBB hex codes. Anything else (XSS payloads, plain
 * names, gibberish) is rejected — caller keeps the prior valid value.
 */
function isValidHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

function ControlContent({ param, value, onChange }: Omit<ParameterControlProps, 'locked'>) {
  // TM-90: Stable id for label↔control association. Each ParameterControl
  // renders one visible <Label>, and the matching control receives this id
  // as `aria-labelledby` (slider/switch) or htmlFor target (input). Without
  // this, axe-core flags 21 critical "form field has no label" issues from
  // TM-80's audit.
  const reactId = React.useId();
  const labelId = `param-${param.key}-${reactId}`;
  return (
    <div className="space-y-1.5">
      <Label id={labelId} className="text-xs text-slate-400 font-medium">{param.label}</Label>

      {param.type === 'color' && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-labelledby={labelId}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              <div
                className="w-5 h-5 rounded-sm border border-slate-500 flex-shrink-0"
                style={{ backgroundColor: value as string }}
              />
              <span className="text-sm text-slate-300 font-mono">{value as string}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 bg-slate-800 border-slate-600" side="left">
            <HexColorPicker color={value as string} onChange={onChange} />
            <Input
              aria-label={`${param.label} hex color`}
              value={value as string}
              onChange={e => {
                const next = e.target.value;
                // Accept any in-progress typing for UX (so users can clear & retype),
                // but only commit a value to upstream state when it's a real hex.
                // Empty / partial input keeps the previous state; invalid (e.g. XSS,
                // 'red', random text) is dropped at the boundary.
                if (next === '' || isValidHexColor(next)) onChange(next);
              }}
              className="mt-2 bg-slate-700 border-slate-600 text-white font-mono text-xs"
              placeholder="#000000"
            />
          </PopoverContent>
        </Popover>
      )}

      {param.type === 'range' && (
        <div className="flex items-center gap-3">
          <Slider
            aria-labelledby={labelId}
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 0.1}
            value={[clampNumber(value as number, param.min, param.max)]}
            onValueChange={([v]) => onChange(clampNumber(v, param.min, param.max))}
            className="flex-1"
          />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              aria-label={`${param.label} value${param.unit ? ` (${param.unit})` : ''}`}
              value={value as number}
              min={param.min}
              max={param.max}
              step={param.step ?? 0.1}
              onChange={e => {
                const raw = e.target.value;
                // Allow empty buffer while user is mid-edit; don't propagate NaN.
                if (raw === '' || raw === '-') return;
                const n = parseFloat(raw);
                if (!Number.isFinite(n)) return; // reject NaN/Infinity
                onChange(clampNumber(n, param.min, param.max));
              }}
              className="w-20 bg-slate-700 border-slate-600 text-white text-xs text-center"
            />
            {/* text-slate-400 (was 500) for WCAG AA on bg-slate-900 (TM-90). */}
            {param.unit && <span aria-hidden className="text-xs text-slate-400">{param.unit}</span>}
          </div>
        </div>
      )}

      {param.type === 'text' && (
        <Input
          aria-labelledby={labelId}
          value={value as string}
          onChange={e => onChange(e.target.value)}
          className="bg-slate-700 border-slate-600 text-white"
        />
      )}

      {param.type === 'boolean' && (
        <div className="flex items-center gap-2">
          <Switch
            aria-labelledby={labelId}
            checked={value as boolean}
            onCheckedChange={onChange}
          />
          <span className="text-sm text-slate-400">{value ? 'On' : 'Off'}</span>
        </div>
      )}

      {param.type === 'icon' && (
        <IconPickerControl
          ariaLabelledBy={labelId}
          value={(value as string) || DEFAULT_LUCIDE_ICON}
          onChange={onChange}
        />
      )}

      {(param.type === 'image' || param.type === 'font') && (
        <UploadParameterControl
          ariaLabelledBy={labelId}
          param={param}
          value={value as string}
          onChange={onChange}
        />
      )}

      {param.type === 'select' && (
        <Select value={value as string} onValueChange={onChange}>
          <SelectTrigger aria-labelledby={labelId} className="bg-slate-700 border-slate-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            {param.options?.map(opt => (
              <SelectItem key={opt} value={opt} className="text-white hover:bg-slate-700">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

interface IconPickerControlProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabelledBy?: string;
}

interface LucideIconRenderProps {
  name: string;
  size?: number;
  className?: string;
}

function LucideIconRender({ name, size = 18, className }: LucideIconRenderProps) {
  return React.createElement(resolveLucideIcon(name), { size, className });
}

interface UploadParameterControlProps {
  param: Parameter;
  value: string;
  onChange: (value: string) => void;
  ariaLabelledBy?: string;
}

interface UploadedAssetSummary {
  id: string;
  kind: 'image' | 'font';
  filename: string;
  url: string;
  fontFamily: string | null;
}

/**
 * Inline picker for `image` / `font` PARAMS. Lists the user's uploaded assets
 * (filtered by kind) and lets them pick one — the param value becomes the
 * public URL (image) or font family name (font). Upload happens in the
 * sibling `ResourcePanel`; this control is read-only on uploads.
 */
function UploadParameterControl({ param, value, onChange, ariaLabelledBy }: UploadParameterControlProps) {
  const [uploads, setUploads] = useState<UploadedAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const kind = param.type === 'image' ? 'image' : 'font';

  React.useEffect(() => {
    // Subscribe to /api/upload for this kind. We deliberately mark loading
    // via the async closure (not a sync setState in the effect body) so we
    // don't trigger the react-hooks/set-state-in-effect lint, while still
    // showing a loading state on first paint.
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/upload?kind=${kind}`, { signal: controller.signal });
        const d = r.ok ? await r.json() : { uploads: [] };
        if (!cancelled) {
          setUploads(d.uploads || []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [kind]);

  return (
    <div className="space-y-1.5">
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={ariaLabelledBy} className="bg-slate-700 border-slate-600 text-white text-xs">
          <SelectValue placeholder={loading ? 'Loading…' : `Pick ${kind}…`} />
        </SelectTrigger>
        <SelectContent className="bg-slate-800 border-slate-600 max-h-72">
          {uploads.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">
              No {kind}s uploaded yet. Use the Resources panel.
            </div>
          )}
          {uploads.map(u => {
            const optionValue = kind === 'font' ? (u.fontFamily ?? u.filename) : u.url;
            return (
              <SelectItem key={u.id} value={optionValue} className="text-white hover:bg-slate-700 text-xs">
                {u.filename}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {value && kind === 'image' && (
        <div className="mt-1 text-[10px] text-slate-400 truncate font-mono">{value}</div>
      )}
    </div>
  );
}

function IconPickerControl({ value, onChange, ariaLabelledBy }: IconPickerControlProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchLucideCatalog(query), [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-labelledby={ariaLabelledBy}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 transition-colors"
        >
          <LucideIconRender name={value} size={18} className="text-slate-200 flex-shrink-0" />
          <span className="text-sm text-slate-300 font-mono truncate">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 bg-slate-800 border-slate-600"
        side="left"
        align="start"
      >
        <Input
          aria-label="Search icons"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="bg-slate-700 border-slate-600 text-white text-xs mb-2"
        />
        <div className="grid grid-cols-6 gap-1 max-h-56 overflow-y-auto">
          {results.map(entry => {
            const active = entry.name === value;
            return (
              <button
                key={entry.name}
                type="button"
                title={entry.name}
                onClick={() => {
                  onChange(entry.name);
                  setOpen(false);
                }}
                className={
                  'flex items-center justify-center aspect-square rounded-md border transition-colors ' +
                  (active
                    ? 'border-violet-500 bg-violet-900/40 text-violet-200'
                    : 'border-slate-700 bg-slate-700/40 text-slate-300 hover:bg-slate-700')
                }
              >
                <LucideIconRender name={entry.name} size={18} />
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="col-span-6 text-center text-xs text-slate-400 py-4">
              No icons match &quot;{query}&quot;
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
