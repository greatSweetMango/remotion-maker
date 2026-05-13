import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import {
  decodeTags,
  encodeTags,
  normalizeFolder,
  normalizeTags,
  TagsValidationError,
} from '@/lib/asset/tags';

/**
 * POST /api/assets/bulk
 *
 * Apply a single action to multiple assets owned by the current user (TM-107).
 *
 * Body: {
 *   ids: string[]                  // 1..MAX_IDS asset ids
 *   action:
 *     | { type: 'tag-add', tags: string[] }       // union with existing tags
 *     | { type: 'tag-remove', tags: string[] }    // set difference
 *     | { type: 'tag-set', tags: string[] }       // replace whole tag set
 *     | { type: 'folder-move', folder: string|null }
 *     | { type: 'soft-delete' }
 * }
 *
 * Behavior:
 *   - Owner-scoped: ids the caller does not own (or that are already
 *     soft-deleted, except for `soft-delete` which is idempotent) are
 *     silently ignored. Response reports `affected` = how many rows actually
 *     changed and `skipped` = ids that were filtered out.
 *   - Tag actions short-circuit when the resulting tag set is identical to
 *     the existing one to avoid spurious `updatedAt` churn that would
 *     reorder the dashboard list.
 *
 * Response: { affected: number, skipped: string[] }
 */

const MAX_IDS = 200;

interface BulkBody {
  ids?: unknown;
  action?: {
    type?: unknown;
    tags?: unknown;
    folder?: unknown;
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: BulkBody = {};
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
  }
  if (body.ids.length > MAX_IDS) {
    return NextResponse.json({ error: `too many ids (max ${MAX_IDS})` }, { status: 400 });
  }
  const ids: string[] = [];
  for (const x of body.ids) {
    if (typeof x !== 'string' || !x) {
      return NextResponse.json({ error: 'ids must be non-empty strings' }, { status: 400 });
    }
    if (!ids.includes(x)) ids.push(x);
  }

  const action = body.action;
  if (!action || typeof action.type !== 'string') {
    return NextResponse.json({ error: 'action.type is required' }, { status: 400 });
  }

  // Pre-validate action payloads up front so we don't open a DB transaction
  // only to abort on a parse error.
  let preparedTags: string[] | null = null;
  let preparedFolder: string | null = null;
  try {
    if (action.type === 'tag-add' || action.type === 'tag-remove' || action.type === 'tag-set') {
      preparedTags = normalizeTags(action.tags);
      if (preparedTags.length === 0 && action.type !== 'tag-set') {
        return NextResponse.json({ error: 'tags must contain at least one entry' }, { status: 400 });
      }
    } else if (action.type === 'folder-move') {
      if (!('folder' in action)) {
        return NextResponse.json({ error: 'action.folder is required' }, { status: 400 });
      }
      preparedFolder = normalizeFolder(action.folder);
    } else if (action.type !== 'soft-delete') {
      return NextResponse.json({ error: `unknown action.type: ${action.type}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof TagsValidationError ? err.message : 'Invalid action';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Scope to owned, non-trashed assets (soft-delete itself filters trash later).
  const owned = await prisma.asset.findMany({
    where: {
      id: { in: ids },
      userId: session.user.id,
      ...(action.type === 'soft-delete' ? {} : { deletedAt: null }),
    },
    select: { id: true, tags: true, folder: true, deletedAt: true },
  });
  const ownedIds = new Set(owned.map((a) => a.id));
  const skipped = ids.filter((x) => !ownedIds.has(x));

  if (owned.length === 0) {
    return NextResponse.json({ affected: 0, skipped });
  }

  let affected = 0;

  if (action.type === 'soft-delete') {
    const now = new Date();
    const targets = owned.filter((a) => !a.deletedAt).map((a) => a.id);
    if (targets.length > 0) {
      const res = await prisma.asset.updateMany({
        where: { id: { in: targets }, userId: session.user.id },
        data: { deletedAt: now },
      });
      affected = res.count;
    }
  } else if (action.type === 'folder-move') {
    // Skip rows already in the target folder so updatedAt doesn't churn.
    const targets = owned.filter((a) => (a.folder ?? null) !== preparedFolder).map((a) => a.id);
    if (targets.length > 0) {
      const res = await prisma.asset.updateMany({
        where: { id: { in: targets }, userId: session.user.id },
        data: { folder: preparedFolder },
      });
      affected = res.count;
    }
  } else {
    // Tag actions: per-row read-modify-write to compute set union/diff.
    // Volume cap (MAX_IDS=200) keeps this safe without batching.
    const tagSet = new Set(preparedTags ?? []);
    const ops: Promise<unknown>[] = [];
    for (const a of owned) {
      const current = decodeTags(a.tags);
      let next: string[];
      if (action.type === 'tag-add') {
        next = [...current];
        for (const t of tagSet) if (!next.includes(t)) next.push(t);
      } else if (action.type === 'tag-remove') {
        next = current.filter((t) => !tagSet.has(t));
      } else {
        // tag-set
        next = [...tagSet];
      }
      // No-op skip
      if (
        next.length === current.length &&
        next.every((t, i) => t === current[i])
      ) {
        continue;
      }
      affected += 1;
      ops.push(
        prisma.asset.update({
          where: { id: a.id },
          data: { tags: encodeTags(next) },
          select: { id: true },
        }),
      );
    }
    if (ops.length > 0) await Promise.all(ops);
  }

  return NextResponse.json({ affected, skipped });
}
