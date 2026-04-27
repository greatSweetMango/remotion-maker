'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Clock, Calendar, Trash2 } from 'lucide-react';
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
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AssetCard({ asset, tier, onDeleted }: AssetCardProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const versionCount = asset._count?.versions ?? 0;

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isDeleting) return;
    if (!confirm(`Move "${asset.title}" to Trash? You can restore it within 30 days.`)) return;
    setIsDeleting(true);
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
      setIsDeleting(false);
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
        <h3 className="text-white text-sm font-medium truncate">{asset.title}</h3>
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
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting || isPending}
        aria-label={`Move ${asset.title} to trash`}
        data-testid="asset-card-delete"
        className="absolute top-2 left-2 inline-flex items-center justify-center h-7 w-7 rounded-md bg-slate-900/80 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-300 hover:bg-red-950/70 disabled:opacity-50 transition"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
