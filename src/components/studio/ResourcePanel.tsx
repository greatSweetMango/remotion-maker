'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Image as ImageIcon, Type as FontIcon, Trash2, UploadCloud } from 'lucide-react';
import type { Tier } from '@/types';

/**
 * ResourcePanel — drag-and-drop uploader + list of the user's images / fonts.
 *
 * Mounted inside CustomizePanel under the "Resources" section. The list it
 * fetches is also consumed by `UploadParameterControl` via the same /api/upload
 * endpoint; both auto-refresh after a successful upload via `onChanged`.
 *
 * Free tier sees a quota counter; over-limit uploads return 403 with
 * `upgradeRequired: true` and we surface the message inline.
 */

interface UploadedAsset {
  id: string;
  kind: 'image' | 'font';
  filename: string;
  url: string;
  fontFamily: string | null;
  sizeBytes: number;
  createdAt: string;
}

interface ResourcePanelProps {
  tier: Tier;
  onChanged?: () => void;
}

const FREE_LIMITS = { image: 5, font: 3 } as const;

export function ResourcePanel({ tier, onChanged }: ResourcePanelProps) {
  const [uploads, setUploads] = useState<UploadedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<null | 'image' | 'font'>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/upload');
      if (!r.ok) return;
      const d = await r.json();
      setUploads(d.uploads || []);
      onChanged?.();
    } catch {
      /* silent */
    }
  }, [onChanged]);

  useEffect(() => {
    // Initial fetch — wrap in an async IIFE so setState happens after the
    // network round-trip rather than synchronously in the effect body
    // (avoids the react-hooks/set-state-in-effect lint).
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const upload = useCallback(async (file: File, kind: 'image' | 'font') => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error || `Upload failed (${r.status})`);
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/upload/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const images = uploads.filter(u => u.kind === 'image');
  const fonts = uploads.filter(u => u.kind === 'font');

  return (
    <div className="space-y-4">
      <DropZone
        kind="image"
        label="Images"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        Icon={ImageIcon}
        active={dragOver === 'image'}
        onDragState={s => setDragOver(s ? 'image' : null)}
        onFile={f => upload(f, 'image')}
        tier={tier}
        currentCount={images.length}
        kindLimit={FREE_LIMITS.image}
        disabled={busy}
      />
      <ResourceList items={images} kind="image" onRemove={remove} disabled={busy} />

      <DropZone
        kind="font"
        label="Fonts"
        accept=".otf,.ttf,.woff,.woff2,font/otf,font/ttf,font/woff,font/woff2"
        Icon={FontIcon}
        active={dragOver === 'font'}
        onDragState={s => setDragOver(s ? 'font' : null)}
        onFile={f => upload(f, 'font')}
        tier={tier}
        currentCount={fonts.length}
        kindLimit={FREE_LIMITS.font}
        disabled={busy}
      />
      <ResourceList items={fonts} kind="font" onRemove={remove} disabled={busy} />

      {error && (
        <div className="text-xs text-rose-400 bg-rose-900/20 border border-rose-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

interface DropZoneProps {
  kind: 'image' | 'font';
  label: string;
  accept: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onDragState: (over: boolean) => void;
  onFile: (file: File) => void;
  tier: Tier;
  currentCount: number;
  kindLimit: number;
  disabled: boolean;
}

function DropZone(props: DropZoneProps) {
  const { kind, label, accept, Icon, active, onDragState, onFile, tier, currentCount, kindLimit, disabled } = props;
  const inputId = `upload-${kind}`;
  const overLimit = tier === 'FREE' && currentCount >= kindLimit;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-slate-500">
          {tier === 'FREE' ? `${currentCount}/${kindLimit}` : `${currentCount}`}
        </span>
      </div>
      <label
        htmlFor={inputId}
        onDragOver={e => { e.preventDefault(); onDragState(true); }}
        onDragLeave={() => onDragState(false)}
        onDrop={e => {
          e.preventDefault();
          onDragState(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !disabled && !overLimit) onFile(f);
        }}
        className={
          'block rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-colors ' +
          (overLimit
            ? 'border-slate-700 bg-slate-800/40 opacity-50 cursor-not-allowed'
            : active
              ? 'border-violet-500 bg-violet-900/20 text-violet-200'
              : 'border-slate-600 bg-slate-800/40 hover:border-slate-500 text-slate-400')
        }
      >
        <Icon className="h-5 w-5 mx-auto mb-1" />
        <div className="text-xs">
          {overLimit
            ? 'Free limit reached — upgrade to Pro'
            : (<><UploadCloud className="h-3 w-3 inline mr-1" />Drop or click to upload</>)
          }
        </div>
      </label>
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled || overLimit}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

interface ResourceListProps {
  items: UploadedAsset[];
  kind: 'image' | 'font';
  onRemove: (id: string) => void;
  disabled: boolean;
}

function ResourceList({ items, kind, onRemove, disabled }: ResourceListProps) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 mt-1">
      {items.map(u => (
        <li
          key={u.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-slate-800/60 border border-slate-700 text-xs"
        >
          {kind === 'image' ? (
            <span
              className="block w-8 h-8 rounded-sm bg-cover bg-center bg-slate-700"
              style={{ backgroundImage: `url(${u.url})` }}
            />
          ) : (
            <span className="block w-8 h-8 rounded-sm bg-slate-700 flex items-center justify-center text-[10px] text-slate-300 font-semibold">
              Aa
            </span>
          )}
          <span className="flex-1 truncate text-slate-300">{u.filename}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-slate-500 hover:text-rose-400"
            disabled={disabled}
            onClick={() => onRemove(u.id)}
            aria-label={`Delete ${u.filename}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
