'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sparkles,
  Clock,
  Calendar,
  Trash2,
  MoreVertical,
  Pencil,
  Copy,
} from 'lucide-react';
import type { Tier } from '@/types';

export interface AssetCardData {
  id: string;
  title: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  _count?: { versions: number };
}

interface AssetCardProps {
  asset: AssetCardData;
  tier: Tier;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, title: string) => void;
  onDuplicated?: (created: { id: string; title: string }) => void;
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AssetCard({
  asset,
  tier,
  onDeleted,
  onRenamed,
  onDuplicated,
}: AssetCardProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(asset.title);
  const versionCount = asset._count?.versions ?? 0;

  async function handleDelete() {
    if (isBusy) return;
    if (!confirm(`Move "${asset.title}" to Trash? You can restore it within 30 days.`)) return;
    setIsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      onDeleted?.(asset.id);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setIsBusy(false);
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isBusy) return;
    const next = renameValue.trim();
    if (!next) {
      setError('Title cannot be empty');
      return;
    }
    if (next === asset.title) {
      setRenameOpen(false);
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Rename failed (${res.status})`);
      }
      const body = (await res.json()) as { title: string };
      onRenamed?.(asset.id, body.title);
      setRenameOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDuplicate() {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset/${asset.id}/duplicate`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Duplicate failed (${res.status})`);
      }
      const created = (await res.json()) as { id: string; title: string };
      onDuplicated?.(created);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplicate failed');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="relative group" data-testid="asset-card-wrapper" data-asset-id={asset.id}>
      <Link
        href={`/studio?asset=${asset.id}`}
        className="block bg-slate-800/50 rounded-xl border border-slate-700 hover:border-violet-500 transition-all p-4"
        data-testid="asset-card"
        data-asset-id={asset.id}
      >
        <div className="aspect-video bg-slate-900 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden">
          <Sparkles className="h-8 w-8 text-slate-600 group-hover:text-violet-400 transition-colors" />
          <Badge
            className={`absolute top-2 right-2 text-[10px] py-0 px-1.5 ${
              tier === 'PRO'
                ? 'bg-violet-700 text-white border-violet-500'
                : 'bg-slate-700 text-slate-300 border-slate-600'
            }`}
          >
            {tier}
          </Badge>
        </div>
        <h3 className="text-white text-sm font-medium truncate" data-testid="asset-card-title">
          {asset.title}
        </h3>
        <div className="mt-1.5 flex flex-col gap-1 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Created {formatDate(asset.createdAt)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Edited {formatDate(asset.updatedAt)}
          </span>
        </div>
        {versionCount > 1 && (
          <div className="mt-2">
            <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 py-0">
              v{versionCount}
            </Badge>
          </div>
        )}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isBusy}
            aria-label={`Actions for ${asset.title}`}
            data-testid="asset-card-menu"
            className="absolute top-2 left-2 inline-flex items-center justify-center h-7 w-7 rounded-md bg-slate-900/80 text-slate-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-white hover:bg-slate-800 disabled:opacity-50 transition"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            data-testid="asset-card-rename"
            onSelect={(e) => {
              e.preventDefault();
              setRenameValue(asset.title);
              setError(null);
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-4 w-4 mr-2" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="asset-card-duplicate"
            onSelect={(e) => {
              e.preventDefault();
              void handleDuplicate();
            }}
          >
            <Copy className="h-4 w-4 mr-2" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="asset-card-delete"
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Move to Trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}

      <Dialog open={renameOpen} onOpenChange={(o) => !isBusy && setRenameOpen(o)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Rename animation</DialogTitle>
            <DialogDescription className="text-slate-400">
              Pick a new title for this asset. Max 200 characters.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-3">
            <Input
              autoFocus
              value={renameValue}
              maxLength={200}
              onChange={(e) => setRenameValue(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
              data-testid="asset-rename-input"
              aria-label="New title"
            />
            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={isBusy}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isBusy || !renameValue.trim()}
                className="bg-violet-600 hover:bg-violet-700"
                data-testid="asset-rename-submit"
              >
                {isBusy ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
