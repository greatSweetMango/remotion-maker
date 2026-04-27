import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Clock, Calendar } from 'lucide-react';
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
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AssetCard({ asset, tier }: AssetCardProps) {
  const versionCount = asset._count?.versions ?? 0;
  return (
    <Link
      href={`/studio?asset=${asset.id}`}
      className="group bg-slate-800/50 rounded-xl border border-slate-700 hover:border-violet-500 transition-all p-4 flex flex-col"
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
  );
}
