'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sparkles,
  Search,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  X,
  Trash2,
  FolderInput,
  Tag,
} from 'lucide-react';
import { AssetCard, type AssetCardData } from './AssetCard';
import type { Tier } from '@/types';

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface FacetData {
  folders: string[];
  tags: { name: string; count: number }[];
}

interface AssetsResponse {
  assets: AssetCardData[];
  pagination: PaginationInfo;
  facets?: FacetData;
}

interface AssetGridProps {
  initialAssets: AssetCardData[];
  initialPagination: PaginationInfo;
  initialFacets?: FacetData;
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

const ROOT_FOLDER = '__root__';

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

export function AssetGrid({
  initialAssets,
  initialPagination,
  initialFacets,
  tier,
}: AssetGridProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [remoteData, setRemoteData] = useState<AssetsResponse | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated_desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // null = "all", '__root__' = no folder, else folder name
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bulk-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagDraft, setBulkTagDraft] = useState('');
  const [bulkFolderOpen, setBulkFolderOpen] = useState(false);
  const [bulkFolderDraft, setBulkFolderDraft] = useState('');

  const debouncedSearch = useDebounced(search, 350);

  const updateFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  // Tag-filter chip toggle: AND semantics in the API.
  function toggleTagFilter(t: string) {
    setSelectedTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
    setPage(1);
  }

  const isInitialUntouched =
    page === 1 &&
    debouncedSearch === '' &&
    sort === 'updated_desc' &&
    dateFrom === '' &&
    dateTo === '' &&
    selectedTags.length === 0 &&
    selectedFolder === null;

  const assets: AssetCardData[] = isInitialUntouched
    ? initialAssets
    : (remoteData?.assets ?? []);
  const pagination: PaginationInfo = isInitialUntouched
    ? initialPagination
    : (remoteData?.pagination ?? initialPagination);
  const facets: FacetData = remoteData?.facets ??
    initialFacets ?? { folders: [], tags: [] };

  useEffect(() => {
    if (isInitialUntouched) return;

    let cancelled = false;
    const controller = new AbortController();
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
    for (const t of selectedTags) qs.append('tag', t);
    if (selectedFolder !== null) qs.set('folder', selectedFolder);

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
  }, [
    debouncedSearch,
    sort,
    dateFrom,
    dateTo,
    selectedTags,
    selectedFolder,
    page,
    isInitialUntouched,
    initialPagination.pageSize,
  ]);

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

  function clearFilters() {
    setSearch('');
    setSort('updated_desc');
    setDateFrom('');
    setDateTo('');
    setSelectedTags([]);
    setSelectedFolder(null);
    setPage(1);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkError(null);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(assets.map((a) => a.id)));
  }

  // Force a refetch after a mutation while in non-initial state by bumping a
  // dependency. We just call setPage(page) — same value is a no-op — so we
  // instead re-fetch by clearing remoteData when on initial path, otherwise
  // by toggling page through identity. Simpler: trigger router.refresh() to
  // re-render the SSR initial path; for remote view, refetch via state.
  function refreshAfterBulk() {
    startTransition(() => router.refresh());
    // Force the remote-data fetcher to run again by mutating state shape.
    if (!isInitialUntouched) {
      setRemoteData((prev) => (prev ? { ...prev } : prev));
      // setPage same value won't re-trigger effect; nudge via search-debounce
      // dependency shape: bump the debouncedSearch indirectly by no-op.
      setSearch((s) => s);
      // Actually trigger by toggling sort then back is too disruptive.
      // Cleanest: re-fetch directly here.
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('pageSize', String(initialPagination.pageSize));
      if (debouncedSearch) qs.set('search', debouncedSearch);
      qs.set('sort', sort);
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      for (const t of selectedTags) qs.append('tag', t);
      if (selectedFolder !== null) qs.set('folder', selectedFolder);
      void fetch(`/api/assets?${qs.toString()}`)
        .then(async (r) => (r.ok ? ((await r.json()) as AssetsResponse) : null))
        .then((d) => {
          if (d) setRemoteData(d);
        });
    }
  }

  async function runBulkAction(
    action:
      | { type: 'soft-delete' }
      | { type: 'tag-add'; tags: string[] }
      | { type: 'folder-move'; folder: string | null },
  ) {
    if (bulkBusy || selectedIds.size === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const res = await fetch('/api/assets/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Bulk action failed (${res.status})`);
      }
      exitSelectMode();
      refreshAfterBulk();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkTagSubmit() {
    const list = bulkTagDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      setBulkError('Enter at least one tag');
      return;
    }
    setBulkTagOpen(false);
    setBulkTagDraft('');
    await runBulkAction({ type: 'tag-add', tags: list });
  }

  async function handleBulkFolderSubmit() {
    const folder = bulkFolderDraft.trim() || null;
    setBulkFolderOpen(false);
    setBulkFolderDraft('');
    await runBulkAction({ type: 'folder-move', folder });
  }

  const filtersActive =
    !!search ||
    !!dateFrom ||
    !!dateTo ||
    sort !== 'updated_desc' ||
    selectedTags.length > 0 ||
    selectedFolder !== null;

  return (
    <div className="space-y-4">
      {/* Folder + tag facet chips */}
      {(facets.folders.length > 0 || facets.tags.length > 0) && (
        <div className="space-y-2" data-testid="asset-facets">
          {facets.folders.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500 mr-1">Folders:</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedFolder(null);
                  setPage(1);
                }}
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  selectedFolder === null
                    ? 'bg-violet-600/30 border-violet-500 text-white'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
                data-testid="asset-folder-chip-all"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedFolder(ROOT_FOLDER);
                  setPage(1);
                }}
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  selectedFolder === ROOT_FOLDER
                    ? 'bg-violet-600/30 border-violet-500 text-white'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
                data-testid="asset-folder-chip-root"
              >
                (root)
              </button>
              {facets.folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setSelectedFolder(f);
                    setPage(1);
                  }}
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    selectedFolder === f
                      ? 'bg-violet-600/30 border-violet-500 text-white'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                  }`}
                  data-testid={`asset-folder-chip-${f}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {facets.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500 mr-1">Tags:</span>
              {facets.tags.slice(0, 24).map((t) => {
                const active = selectedTags.includes(t.name);
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => toggleTagFilter(t.name)}
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      active
                        ? 'bg-violet-600/30 border-violet-500 text-white'
                        : 'border-slate-700 text-slate-400 hover:text-white'
                    }`}
                    data-testid={`asset-tag-chip-${t.name}`}
                  >
                    {t.name}
                    <span className="ml-1 text-slate-500">{t.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

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
        {filtersActive && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="border-slate-700 text-slate-300"
            data-testid="asset-reset-filters"
          >
            Reset
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          className="border-slate-700 text-slate-300"
          data-testid="asset-toggle-select-mode"
        >
          {selectMode ? <X className="h-4 w-4 mr-1" /> : <CheckSquare className="h-4 w-4 mr-1" />}
          {selectMode ? 'Cancel select' : 'Select'}
        </Button>
      </div>

      {/* Bulk action toolbar */}
      {selectMode && (
        <div
          className="flex flex-wrap items-center gap-2 p-3 bg-slate-800/60 border border-slate-700 rounded-lg"
          data-testid="asset-bulk-toolbar"
        >
          <Badge variant="outline" className="border-slate-600 text-slate-200">
            {selectedIds.size} selected
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={selectAllVisible}
            disabled={bulkBusy || assets.length === 0}
            className="border-slate-700 text-slate-300"
            data-testid="asset-bulk-select-all"
          >
            Select all on page
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBulkTagOpen(true)}
            disabled={bulkBusy || selectedIds.size === 0}
            className="border-slate-700 text-slate-300"
            data-testid="asset-bulk-tag-add"
          >
            <Tag className="h-4 w-4 mr-1" /> Add tags
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBulkFolderOpen(true)}
            disabled={bulkBusy || selectedIds.size === 0}
            className="border-slate-700 text-slate-300"
            data-testid="asset-bulk-folder-move"
          >
            <FolderInput className="h-4 w-4 mr-1" /> Move to folder
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              if (
                confirm(
                  `Move ${selectedIds.size} item(s) to Trash? You can restore within 30 days.`,
                )
              ) {
                void runBulkAction({ type: 'soft-delete' });
              }
            }}
            disabled={bulkBusy || selectedIds.size === 0}
            data-testid="asset-bulk-delete"
          >
            <Trash2 className="h-4 w-4 mr-1" /> Move to Trash
          </Button>
          {bulkError && (
            <span role="alert" className="text-xs text-rose-400">
              {bulkError}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded p-3">
          {error}
        </div>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
          <Sparkles className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 mb-4">
            {filtersActive
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
              <AssetCard
                key={a.id}
                asset={a}
                tier={tier}
                selectMode={selectMode}
                selected={selectedIds.has(a.id)}
                onToggleSelect={toggleSelected}
                onDeleted={(id) => {
                  setRemoteData((prev) =>
                    prev
                      ? {
                          ...prev,
                          assets: prev.assets.filter((x) => x.id !== id),
                          pagination: {
                            ...prev.pagination,
                            total: Math.max(0, prev.pagination.total - 1),
                          },
                        }
                      : prev,
                  );
                }}
                onRenamed={(id, title) => {
                  setRemoteData((prev) =>
                    prev
                      ? {
                          ...prev,
                          assets: prev.assets.map((x) =>
                            x.id === id
                              ? { ...x, title, updatedAt: new Date().toISOString() }
                              : x,
                          ),
                        }
                      : prev,
                  );
                }}
                onTagsChanged={(id, tags) => {
                  setRemoteData((prev) =>
                    prev
                      ? {
                          ...prev,
                          assets: prev.assets.map((x) =>
                            x.id === id ? { ...x, tags } : x,
                          ),
                        }
                      : prev,
                  );
                  startTransition(() => router.refresh());
                }}
                onFolderChanged={(id, folder) => {
                  setRemoteData((prev) =>
                    prev
                      ? {
                          ...prev,
                          assets: prev.assets.map((x) =>
                            x.id === id ? { ...x, folder } : x,
                          ),
                        }
                      : prev,
                  );
                  startTransition(() => router.refresh());
                }}
                onDuplicated={() => {
                  setRemoteData((prev) =>
                    prev
                      ? {
                          ...prev,
                          pagination: {
                            ...prev.pagination,
                            total: prev.pagination.total + 1,
                          },
                        }
                      : prev,
                  );
                }}
              />
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

      <Dialog open={bulkTagOpen} onOpenChange={(o) => !bulkBusy && setBulkTagOpen(o)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Add tags to {selectedIds.size} item(s)</DialogTitle>
            <DialogDescription className="text-slate-400">
              Comma-separated tag names. They will be unioned with each
              asset&apos;s existing tags.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={bulkTagDraft}
            onChange={(e) => setBulkTagDraft(e.target.value)}
            placeholder="brand, hero, draft"
            className="bg-slate-800 border-slate-700 text-white"
            data-testid="asset-bulk-tag-input"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkTagOpen(false)}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkTagSubmit}
              className="bg-violet-600 hover:bg-violet-700"
              data-testid="asset-bulk-tag-submit"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkFolderOpen} onOpenChange={(o) => !bulkBusy && setBulkFolderOpen(o)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Move {selectedIds.size} item(s)</DialogTitle>
            <DialogDescription className="text-slate-400">
              Folder name. Leave blank to move to root.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={bulkFolderDraft}
            onChange={(e) => setBulkFolderDraft(e.target.value)}
            placeholder="(root)"
            className="bg-slate-800 border-slate-700 text-white"
            data-testid="asset-bulk-folder-input"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkFolderOpen(false)}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkFolderSubmit}
              className="bg-violet-600 hover:bg-violet-700"
              data-testid="asset-bulk-folder-submit"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
