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
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Sparkles, Loader2 } from 'lucide-react';
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

  // TM-88: only image params with a stored `regen_prompt` annotation expose
  // the AI Regenerate button. Without a seed prompt we'd be forcing the user
  // to write one from scratch — the upload picker is the better path for that
  // case (or they should re-prompt the whole composition).
  const showRegen = kind === 'image' && typeof param.regenPrompt === 'string' && param.regenPrompt.length > 0;

  return (
    <div className="space-y-1.5">
      {/* TM-88: image preview thumbnail. Shown above the picker when the
          current value resolves to a renderable URL (http(s)/data:). For
          fonts this slot stays empty — the font name is enough. */}
      {kind === 'image' && typeof value === 'string' && /^(https?:|data:image\/)/.test(value) && (
        <div className="rounded-md border border-slate-600 overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URLs / arbitrary hosts; <Image> would require remotePatterns config and breaks for data: */}
          <img
            src={value}
            alt={`${param.label} preview`}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        </div>
      )}

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

      {showRegen && (
        <RegenerateImageButton
          paramKey={param.key}
          paramLabel={param.label}
          initialPrompt={param.regenPrompt ?? ''}
          onRegenerated={onChange}
        />
      )}

      {value && kind === 'image' && (
        <div className="mt-1 text-[10px] text-slate-400 truncate font-mono">{value}</div>
      )}
    </div>
  );
}

interface RegenerateImageButtonProps {
  paramKey: string;
  paramLabel: string;
  initialPrompt: string;
  onRegenerated: (url: string) => void;
}

interface RegenSuccess {
  imageUrl: string;
  costUsd: number;
  latencyMs: number;
}

/**
 * TM-91 — Progressive latency UX helpers.
 *
 * Step messages keyed to elapsed seconds. Thresholds picked from TM-84
 * benchmark (gpt-image-1 p50≈38s, p95≈55s): early reassurance under 5s,
 * acknowledge the long tail past 15s, soften the >30s frustration cliff.
 * Returned copy is intentionally short (single line) so dialog height
 * stays stable across transitions.
 */
export function progressMessage(elapsedMs: number): string {
  const s = elapsedMs / 1000;
  if (s < 5) return '이미지 생성 중…';
  if (s < 15) return 'AI가 그리는 중… (수 초 더 소요됩니다)';
  if (s < 30) return '고품질 렌더 진행 중…';
  return '마무리 단계입니다… 거의 다 됐어요.';
}

/**
 * Logistic-ish progress curve calibrated so the bar hits ~50% near the
 * p50 (38s) and asymptotically approaches 95% — never 100% — so a true
 * completion still feels like a discrete event. Pure function: trivial
 * to unit-test or to swap calibration when TM-92 reduces p50.
 */
export function progressPercent(elapsedMs: number): number {
  const s = elapsedMs / 1000;
  // 1 - exp(-s/k) curve. k=28 → ~50% at 19s, ~74% at 38s, ~90% at 65s.
  // Cap at 95 so the bar never lies about completion.
  const raw = (1 - Math.exp(-s / 28)) * 100;
  return Math.min(95, Math.max(0, raw));
}

/**
 * TM-88 / ADR-0022 — "Regenerate" button for `type:image` PARAMS.
 *
 * Opens a dialog pre-filled with the prompt the AI used to make this image.
 * User can edit it freely (no length cap beyond the server's validatePrompt
 * 2000-char limit). Submit → POST /api/asset/regen-image → response.imageUrl
 * is piped back via `onRegenerated`, which the parent uses to update
 * `paramValues[paramKey]`.
 *
 * Cost & tier semantics: the server enforces PRO-only. Free users will see
 * the 403 surface as an inline error with `upgradeRequired: true`; we render
 * a short message + link cue rather than crashing.
 */
function RegenerateImageButton({
  paramKey,
  paramLabel,
  initialPrompt,
  onRegenerated,
}: RegenerateImageButtonProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RegenSuccess | null>(null);
  // TM-91 — progressive UX: tick elapsed seconds while a regen call is in
  // flight so we can swap step copy (5s/15s/30s thresholds) and animate a
  // logistic Progress bar calibrated to TM-84 p50≈38s. UI only, no backend
  // signal from the server (gpt-image-1 has no streaming progress event).
  const [elapsedMs, setElapsedMs] = useState(0);

  React.useEffect(() => {
    if (!submitting) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => {
      window.clearInterval(id);
    };
  }, [submitting]);

  // Reset prompt buffer to the latest seed whenever the dialog opens —
  // otherwise a previous failed attempt's edits would persist forever.
  // Done in the onOpenChange callback rather than a useEffect to avoid the
  // react-hooks/set-state-in-effect lint (effects with sync setState cause
  // cascading renders — TM-90/TM-91 housekeeping).
  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setPrompt(initialPrompt);
      setError(null);
    }
  }, [initialPrompt]);

  const onSubmit = React.useCallback(async () => {
    if (submitting) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError('Prompt cannot be empty.');
      return;
    }
    setSubmitting(true);
    setElapsedMs(0); // reset progress bar/timer before this attempt — prior attempt's value would briefly flash otherwise
    setError(null);
    try {
      const r = await fetch('/api/asset/regen-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed, paramKey }),
      });
      const d = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) {
        const msg = typeof d.error === 'string' ? d.error : `Regenerate failed (${r.status})`;
        setError(d.upgradeRequired ? `${msg} Upgrade to Pro to use AI image regeneration.` : msg);
        return;
      }
      const imageUrl = typeof d.imageUrl === 'string' ? d.imageUrl : null;
      if (!imageUrl) {
        setError('Response missing imageUrl.');
        return;
      }
      setLastResult({
        imageUrl,
        costUsd: typeof d.costUsd === 'number' ? d.costUsd : 0,
        latencyMs: typeof d.latencyMs === 'number' ? d.latencyMs : 0,
      });
      onRegenerated(imageUrl);
      setOpen(false); // skip seed-reset on programmatic close — keeps lastResult cost line readable
    } catch (err) {
      setError((err as Error)?.message ?? 'Network error');
    } finally {
      setSubmitting(false);
    }
  }, [prompt, paramKey, onRegenerated, submitting]);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs border-violet-700 text-violet-200 hover:bg-violet-900/30 hover:text-white"
          onClick={() => handleOpenChange(true)}
          data-testid={`regen-image-btn-${paramKey}`}
        >
          <Sparkles aria-hidden className="h-3 w-3 mr-1" />
          Regenerate with AI
        </Button>
        {lastResult && (
          <span className="text-[10px] text-slate-500 font-mono">
            ${lastResult.costUsd.toFixed(2)} · {Math.round(lastResult.latencyMs / 100) / 10}s
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Regenerate {paramLabel}</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Edit the prompt and we&apos;ll generate a fresh image. ~$0.04 per call (Pro only). 보통 30~40초 소요됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`regen-prompt-${paramKey}`} className="text-xs text-slate-300">
              Prompt
            </Label>
            <Textarea
              id={`regen-prompt-${paramKey}`}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={submitting}
              rows={5}
              className="bg-slate-800 border-slate-600 text-white text-xs"
              data-testid={`regen-prompt-input-${paramKey}`}
            />
            {error && (
              <p className="text-xs text-red-400" role="alert">
                {error}
              </p>
            )}
            {submitting && (
              <div
                className="space-y-1.5 pt-1"
                role="status"
                aria-live="polite"
                data-testid={`regen-progress-${paramKey}`}
              >
                <Progress
                  value={progressPercent(elapsedMs)}
                  className="h-1 bg-slate-800"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span data-testid={`regen-progress-msg-${paramKey}`}>
                    {progressMessage(elapsedMs)}
                  </span>
                  <span className="font-mono tabular-nums">
                    {Math.floor(elapsedMs / 1000)}s
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={submitting || prompt.trim().length === 0}
              className="bg-violet-600 hover:bg-violet-700 text-white"
              data-testid={`regen-submit-${paramKey}`}
            >
              {submitting ? (
                <>
                  <Loader2 aria-hidden className="h-3 w-3 mr-1 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles aria-hidden className="h-3 w-3 mr-1" />
                  Regenerate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
