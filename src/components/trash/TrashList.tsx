'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RotateCcw, Trash2, Sparkles } from 'lucide-react';

export interface TrashItemData {
  id: string;
  title: string;
  deletedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface TrashListProps {
  initialItems: TrashItemData[];
  retentionDays: number;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysRemaining(deletedAt: string, retentionDays: number): number {
  const ms = new Date(deletedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000 - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function TrashList({ initialItems, retentionDays }: TrashListProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleRestore(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/trash/${id}/restore`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Restore failed (${res.status})`);
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteForever(id: string) {
    if (!confirm('Permanently delete this animation? This cannot be undone.')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/trash/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-12 text-center">
        <Trash2 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Trash is empty.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-700 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}
      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/40">
        {items.map((item) => {
          const remaining = daysRemaining(item.deletedAt, retentionDays);
          const isBusy = busyId === item.id || isPending;
          return (
            <li
              key={item.id}
              data-testid="trash-item"
              data-asset-id={item.id}
              className="flex items-center gap-4 px-4 py-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-800">
                <Sparkles className="h-4 w-4 text-slate-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{item.title}</p>
                <p className="text-xs text-slate-500">
                  Deleted {formatDate(item.deletedAt)} · {remaining}{' '}
                  {remaining === 1 ? 'day' : 'days'} left
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(item.id)}
                  disabled={isBusy}
                  data-testid="trash-restore"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Restore
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeleteForever(item.id)}
                  disabled={isBusy}
                  data-testid="trash-delete-forever"
                  className="border-red-800 text-red-300 hover:bg-red-950 hover:text-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete forever
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
