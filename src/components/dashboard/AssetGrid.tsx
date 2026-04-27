'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sparkles, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { AssetCard, type AssetCardData } from './AssetCard';
import type { Tier } from '@/types';

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface AssetsResponse {
  assets: AssetCardData[];
  pagination: PaginationInfo;
}

interface AssetGridProps {
  initialAssets: AssetCardData[];
  initialPagination: PaginationInfo;
  tier: Tier;
}

type SortKey = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';

const SORT_LABELS: Record<SortKey, string> = {
  updated_desc: 'Recently edited',
  updated_asc: 'Oldest edited',
  created_desc: 'Newest first',
  created_asc: 'Oldest first',
  name_asc: 'Name (A→Z)',
  name_desc: 'Name (Z→A)',
};

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

export function AssetGrid({ initialAssets, initialPagination, tier }: AssetGridProps) {
  const [remoteData, setRemoteData] = useState<AssetsResponse | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated_desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 350);

  // Reset to page 1 when filters change — wrap in handlers below instead of effect.
  const updateFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const isInitialUntouched =
    page === 1 &&
    debouncedSearch === '' &&
    sort === 'updated_desc' &&
    dateFrom === '' &&
    dateTo === '';

  // Derive view from initial server data or fetched remote data.
  const assets: AssetCardData[] = isInitialUntouched
    ? initialAssets
    : (remoteData?.assets ?? []);
  const pagination: PaginationInfo = isInitialUntouched
    ? initialPagination
    : (remoteData?.pagination ?? initialPagination);

  useEffect(() => {
    if (isInitialUntouched) {
      // Initial unfiltered view uses server-rendered data; no fetch needed.
      // Stale remoteData remains in memory but is ignored by the derived view.
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    // Loading + error are render-only flags driven by this fetch lifecycle;
    // setting them here is the correct point to mirror the in-flight state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('pageSize', String(initialPagination.pageSize));
    if (debouncedSearch) qs.set('search', debouncedSearch);
    qs.set('sort', sort);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);

    fetch(`/api/assets?${qs.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AssetsResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setRemoteData(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debouncedSearch, sort, dateFrom, dateTo, page, isInitialUntouched, initialPagination.pageSize]);

  const showingFrom = (pagination.page - 1) * pagination.pageSize + 1;
  const showingTo = Math.min(pagination.total, pagination.page * pagination.pageSize);

  const sortItems = useMemo(
    () =>
      (Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
        <SelectItem key={k} value={k}>
          {SORT_LABELS[k]}
        </SelectItem>
      )),
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-slate-400 mb-1 block">Search</label>
          <div className="relative">
            <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              type="search"
              placeholder="Search by title…"
              value={search}
              onChange={(e) => updateFilter(setSearch)(e.target.value)}
              className="pl-9 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500"
              data-testid="asset-search"
            />
          </div>
        </div>
        <div className="w-full lg:w-44">
          <label className="text-xs text-slate-400 mb-1 block">Sort</label>
          <Select value={sort} onValueChange={(v) => updateFilter(setSort)(v as SortKey)}>
            <SelectTrigger className="bg-slate-800/60 border-slate-700 text-white" data-testid="asset-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{sortItems}</SelectContent>
          </Select>
        </div>
        <div className="w-full lg:w-40">
          <label className="text-xs text-slate-400 mb-1 block">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => updateFilter(setDateFrom)(e.target.value)}
            className="bg-slate-800/60 border-slate-700 text-white"
            data-testid="asset-date-from"
          />
        </div>
        <div className="w-full lg:w-40">
          <label className="text-xs text-slate-400 mb-1 block">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => updateFilter(setDateTo)(e.target.value)}
            className="bg-slate-800/60 border-slate-700 text-white"
            data-testid="asset-date-to"
          />
        </div>
        {(search || dateFrom || dateTo || sort !== 'updated_desc') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch('');
              setSort('updated_desc');
              setDateFrom('');
              setDateTo('');
              setPage(1);
            }}
            className="border-slate-700 text-slate-300"
            data-testid="asset-reset-filters"
          >
            Reset
          </Button>
        )}
      </div>

      {error && (
        <div className="text-sm text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded p-3">
          {error}
        </div>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
          <Sparkles className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 mb-4">
            {debouncedSearch || dateFrom || dateTo
              ? 'No animations match your filters'
              : 'No animations yet'}
          </p>
          <Button asChild className="bg-violet-600 hover:bg-violet-700">
            <Link href="/studio">Create your first animation</Link>
          </Button>
        </div>
      ) : (
        <>
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ${
              loading ? 'opacity-60' : ''
            }`}
            data-testid="asset-grid"
          >
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} tier={tier} />
            ))}
          </div>

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-3" data-testid="asset-pagination">
              <span className="text-xs text-slate-500">
                Showing {showingFrom}–{showingTo} of {pagination.total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="border-slate-700 text-slate-300"
                  data-testid="asset-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="text-xs text-slate-400">
                  Page {pagination.page} / {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages || loading}
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  className="border-slate-700 text-slate-300"
                  data-testid="asset-next-page"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
