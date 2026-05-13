'use client';

import { useState, useRef, useTransition, type ChangeEvent, type KeyboardEvent } from 'react';
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
  FolderInput,
  Tag,
  X,
  ImagePlus,
  ImageOff,
} from 'lucide-react';
import type { Tier } from '@/types';

export interface AssetCardData {
  id: string;
  title: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  tags?: string[];
  folder?: string | null;
  thumbnailUrl?: string | null;
  _count?: { versions: number };
}

interface AssetCardProps {
  asset: AssetCardData;
  tier: Tier;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, title: string) => void;
  onDuplicated?: (created: { id: string; title: string }) => void;
  onTagsChanged?: (id: string, tags: string[]) => void;
  onFolderChanged?: (id: string, folder: string | null) => void;
  onThumbnailChanged?: (id: string, thumbnailUrl: string | null) => void;
}

// Mirror of MAX_THUMBNAIL_BYTES in src/app/api/asset/[id]/thumbnail/route.ts
// — duplicated client-side so the picker rejects oversized files before we
// burn an upload round-trip. Keep in sync with the server constant.
const MAX_THUMBNAIL_BYTES = 1 * 1024 * 1024;
const ALLOWED_THUMBNAIL_TYPES = 'image/png,image/jpeg,image/webp';

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
  selectMode = false,
  selected = false,
  onToggleSelect,
  onDeleted,
  onRenamed,
  onDuplicated,
  onTagsChanged,
  onFolderChanged,
  onThumbnailChanged,
}: AssetCardProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(
    asset.thumbnailUrl ?? null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(asset.title);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [editingTags, setEditingTags] = useState<string[]>(asset.tags ?? []);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState(asset.folder ?? '');
  const versionCount = asset._count?.versions ?? 0;
  const tags = asset.tags ?? [];

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

  function commitTagDraft() {
    const t = tagDraft.trim();
    if (!t) return;
    if (editingTags.includes(t)) {
      setTagDraft('');
      return;
    }
    setEditingTags((prev) => [...prev, t]);
    setTagDraft('');
  }

  function handleTagDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTagDraft();
    } else if (e.key === 'Backspace' && tagDraft === '' && editingTags.length > 0) {
      setEditingTags((prev) => prev.slice(0, -1));
    }
  }

  async function handleTagsSave() {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    // Flush any pending draft text first so a half-typed chip isn't lost.
    const finalTags = (() => {
      const t = tagDraft.trim();
      if (!t || editingTags.includes(t)) return editingTags;
      return [...editingTags, t];
    })();
    try {
      const res = await fetch(`/api/asset/${asset.id}/tags`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: finalTags }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Tag save failed (${res.status})`);
      }
      const body = (await res.json()) as { tags: string[] };
      onTagsChanged?.(asset.id, body.tags);
      setTagsOpen(false);
      setTagDraft('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tag save failed');
    } finally {
      setIsBusy(false);
    }
  }

  function openThumbnailPicker() {
    if (isBusy) return;
    setError(null);
    fileInputRef.current?.click();
  }

  async function handleThumbnailFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Reset the input so picking the same file twice still re-fires `change`.
    e.target.value = '';
    if (!file) return;
    if (isBusy) return;

    if (!ALLOWED_THUMBNAIL_TYPES.split(',').includes(file.type)) {
      setError('Thumbnail must be PNG, JPG, or WebP.');
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setError(
        `Thumbnail too large (max ${Math.round(MAX_THUMBNAIL_BYTES / 1024)} KB).`,
      );
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/asset/${asset.id}/thumbnail`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      const body = (await res.json()) as { thumbnailUrl: string };
      setThumbnailUrl(body.thumbnailUrl);
      onThumbnailChanged?.(asset.id, body.thumbnailUrl);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleThumbnailRemove() {
    if (isBusy) return;
    if (!thumbnailUrl) return;
    setIsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset/${asset.id}/thumbnail`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Remove failed (${res.status})`);
      }
      setThumbnailUrl(null);
      onThumbnailChanged?.(asset.id, null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFolderSave() {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    const next = folderDraft.trim() || null;
    try {
      const res = await fetch(`/api/asset/${asset.id}/folder`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folder: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Folder save failed (${res.status})`);
      }
      const body = (await res.json()) as { folder: string | null };
      onFolderChanged?.(asset.id, body.folder);
      setFolderOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder save failed');
    } finally {
      setIsBusy(false);
    }
  }

  // In select mode, the whole card area becomes a checkbox toggle and the
  // <Link> wrapper degrades to a div so navigation doesn't fight selection.
  const cardInner = (
    <div
      className={`block bg-slate-800/50 rounded-xl border ${
        selected
          ? 'border-violet-500 ring-2 ring-violet-500/40'
          : 'border-slate-700 hover:border-violet-500'
      } transition-all p-4`}
      data-testid="asset-card"
      data-asset-id={asset.id}
    >
      <div
        className="aspect-video bg-slate-900 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden"
        data-testid="asset-card-thumbnail"
      >
        {thumbnailUrl ? (
          // Plain <img> on purpose — these are user-uploaded local files
          // served from /public, so next/image's optimizer (which expects
          // remote/known assets) buys nothing here and would force us into
          // remotePatterns config every time a new file lands.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`${asset.title} thumbnail`}
            className="h-full w-full object-cover"
            data-testid="asset-card-thumbnail-img"
          />
        ) : (
          <Sparkles className="h-8 w-8 text-slate-600 group-hover:text-violet-400 transition-colors" />
        )}
        <Badge
          className={`absolute top-2 right-2 text-[10px] py-0 px-1.5 ${
            tier === 'PRO'
              ? 'bg-violet-700 text-white border-violet-500'
              : 'bg-slate-700 text-slate-300 border-slate-600'
          }`}
        >
          {tier}
        </Badge>
        {asset.folder && (
          <Badge
            className="absolute bottom-2 left-2 text-[10px] py-0 px-1.5 bg-slate-900/80 border-slate-600 text-slate-200"
            data-testid="asset-card-folder"
          >
            {asset.folder}
          </Badge>
        )}
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
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="asset-card-tags">
          {tags.slice(0, 5).map((t) => (
            <Badge
              key={t}
              variant="outline"
              className="text-[10px] py-0 px-1.5 border-slate-600 text-slate-300"
            >
              {t}
            </Badge>
          ))}
          {tags.length > 5 && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-slate-700 text-slate-500">
              +{tags.length - 5}
            </Badge>
          )}
        </div>
      )}
      {versionCount > 1 && (
        <div className="mt-2">
          <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 py-0">
            v{versionCount}
          </Badge>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative group" data-testid="asset-card-wrapper" data-asset-id={asset.id}>
      {selectMode ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.(asset.id)}
          aria-pressed={selected}
          aria-label={`Select ${asset.title}`}
          data-testid="asset-card-select-toggle"
          className="block w-full text-left"
        >
          {cardInner}
        </button>
      ) : (
        <Link href={`/studio?asset=${asset.id}`}>{cardInner}</Link>
      )}

      {selectMode && (
        <div
          className={`absolute top-2 left-2 h-5 w-5 rounded border flex items-center justify-center text-[11px] font-bold ${
            selected
              ? 'bg-violet-600 border-violet-400 text-white'
              : 'bg-slate-900/80 border-slate-600 text-transparent'
          }`}
          aria-hidden
        >
          {selected ? '✓' : ''}
        </div>
      )}

      {!selectMode && (
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
              data-testid="asset-card-edit-tags"
              onSelect={(e) => {
                e.preventDefault();
                setEditingTags(asset.tags ?? []);
                setTagDraft('');
                setError(null);
                setTagsOpen(true);
              }}
            >
              <Tag className="h-4 w-4 mr-2" /> Edit tags
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="asset-card-edit-folder"
              onSelect={(e) => {
                e.preventDefault();
                setFolderDraft(asset.folder ?? '');
                setError(null);
                setFolderOpen(true);
              }}
            >
              <FolderInput className="h-4 w-4 mr-2" /> Move to folder
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
            <DropdownMenuItem
              data-testid="asset-card-upload-thumbnail"
              onSelect={(e) => {
                e.preventDefault();
                openThumbnailPicker();
              }}
            >
              <ImagePlus className="h-4 w-4 mr-2" />
              {thumbnailUrl ? 'Replace thumbnail' : 'Upload thumbnail'}
            </DropdownMenuItem>
            {thumbnailUrl && (
              <DropdownMenuItem
                data-testid="asset-card-remove-thumbnail"
                onSelect={(e) => {
                  e.preventDefault();
                  void handleThumbnailRemove();
                }}
              >
                <ImageOff className="h-4 w-4 mr-2" /> Remove thumbnail
              </DropdownMenuItem>
            )}
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
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_THUMBNAIL_TYPES}
        className="hidden"
        data-testid="asset-card-thumbnail-input"
        onChange={handleThumbnailFile}
      />

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

      <Dialog open={tagsOpen} onOpenChange={(o) => !isBusy && setTagsOpen(o)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Edit tags</DialogTitle>
            <DialogDescription className="text-slate-400">
              Press Enter or comma to add. Backspace removes the last tag.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div
              className="flex flex-wrap gap-1 p-2 bg-slate-800 border border-slate-700 rounded-md min-h-[40px]"
              data-testid="asset-tag-editor"
            >
              {editingTags.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="text-[11px] py-0.5 px-2 border-slate-600 text-slate-200 flex items-center gap-1"
                >
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => setEditingTags((prev) => prev.filter((x) => x !== t))}
                    className="hover:text-rose-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={handleTagDraftKey}
                onBlur={commitTagDraft}
                className="flex-1 min-w-[80px] bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                placeholder={editingTags.length === 0 ? 'Add a tag…' : ''}
                data-testid="asset-tag-input"
                maxLength={32}
                autoFocus
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTagsOpen(false)}
                disabled={isBusy}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleTagsSave}
                disabled={isBusy}
                className="bg-violet-600 hover:bg-violet-700"
                data-testid="asset-tags-submit"
              >
                {isBusy ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={folderOpen} onOpenChange={(o) => !isBusy && setFolderOpen(o)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Move to folder</DialogTitle>
            <DialogDescription className="text-slate-400">
              Type a folder name. Leave blank to move to root.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              value={folderDraft}
              maxLength={64}
              onChange={(e) => setFolderDraft(e.target.value)}
              placeholder="(root)"
              className="bg-slate-800 border-slate-700 text-white"
              data-testid="asset-folder-input"
              aria-label="Folder name"
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
                onClick={() => setFolderOpen(false)}
                disabled={isBusy}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleFolderSave}
                disabled={isBusy}
                className="bg-violet-600 hover:bg-violet-700"
                data-testid="asset-folder-submit"
              >
                {isBusy ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
