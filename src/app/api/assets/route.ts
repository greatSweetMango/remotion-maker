import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { decodeTags } from '@/lib/asset/tags';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;

  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const pageSizeRaw = parseInt(sp.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw));
  const search = (sp.get('search') || '').trim();
  // TM-108 — full-text query searches title + generated code + PARAMS body.
  // `search` (title-only, case-insensitive contains) is preserved for backward
  // compat with existing UI/tests; `q` is the new FTS param. When both are
  // present, `search` is applied at DB layer (title contains), then `q` is
  // applied in-memory across {title, code, parameters}.
  const q = (sp.get('q') || '').trim();
  const sort = sp.get('sort') || 'updated_desc';
  const dateFrom = sp.get('dateFrom');
  const dateTo = sp.get('dateTo');
  // TM-107 — tag/folder filters.
  // - `tag` may be repeated (`?tag=foo&tag=bar`) and matches assets whose
  //   tag list contains ALL specified tags (AND semantics).
  // - `folder` selects a single folder; the literal value `__root__` selects
  //   assets with no folder (NULL). Omitting the param disables folder
  //   filtering entirely (returns assets across all folders).
  const tagFilters = sp.getAll('tag').map((t) => t.trim()).filter(Boolean);
  const folderParam = sp.get('folder');

  const where: Prisma.AssetWhereInput = { userId: session.user.id, deletedAt: null };
  if (search) {
    where.title = { contains: search };
  }
  if (dateFrom || dateTo) {
    const range: Prisma.DateTimeFilter = {};
    if (dateFrom) {
      const d = new Date(dateFrom);
      if (!isNaN(d.getTime())) range.gte = d;
    }
    if (dateTo) {
      const d = new Date(dateTo);
      if (!isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        range.lte = d;
      }
    }
    where.updatedAt = range;
  }
  if (folderParam !== null) {
    where.folder = folderParam === '__root__' ? null : folderParam;
  }
  if (tagFilters.length > 0) {
    // SQLite stores tags as a JSON string — fall back to substring match on
    // the encoded form. Each tag must appear as `"tag"` in the column. False
    // positives across tag boundaries are not possible because JSON.stringify
    // always quotes each entry. AND combined via Prisma `AND`.
    where.AND = tagFilters.map((t) => ({
      tags: { contains: JSON.stringify(t) },
    }));
  }

  const orderBy: Prisma.AssetOrderByWithRelationInput =
    sort === 'name_asc'
      ? { title: 'asc' }
      : sort === 'name_desc'
        ? { title: 'desc' }
        : sort === 'created_desc'
          ? { createdAt: 'desc' }
          : sort === 'created_asc'
            ? { createdAt: 'asc' }
            : { updatedAt: 'desc' };

  // TM-108 — when `q` is set, we cannot push the substring scan into Prisma
  // (must search across title + code + parameters, the latter two not being
  // indexable text columns). Strategy: fetch the full filtered set without
  // pagination, filter in-memory, then slice. Per-user asset counts are
  // small (<<1k typical, code/PARAMS are KB-scale), so memory cost is
  // bounded. If usage grows, swap to SQLite FTS5 virtual table (spawn task).
  const useFts = q.length > 0;
  const needle = q.toLowerCase();

  const [total, assets, allFoldersRaw, allTagsRaw] = await Promise.all([
    useFts
      ? Promise.resolve(0) // placeholder; real total computed post-filter below
      : prisma.asset.count({ where }),
    useFts
      ? prisma.asset.findMany({
          where,
          orderBy,
          // Pull all matching rows; pagination applied after JS filter.
          select: {
            id: true,
            userId: true,
            title: true,
            code: true,
            parameters: true,
            folder: true,
            tags: true,
            durationInFrames: true,
            fps: true,
            width: true,
            height: true,
            publicSlug: true,
            sharedAt: true,
            sourceAssetId: true,
            templateSourceId: true,
            thumbnailUrl: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { versions: true } },
          },
        })
      : prisma.asset.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            _count: { select: { versions: true } },
          },
        }),
    // Distinct folder list for sidebar/grouping — scoped to the user, not
    // the current filter, so the chip list stays stable as filters change.
    prisma.asset.findMany({
      where: { userId: session.user.id, deletedAt: null, folder: { not: null } },
      select: { folder: true },
      distinct: ['folder'],
    }),
    // Tags need decoding+aggregation in JS because they're JSON strings.
    prisma.asset.findMany({
      where: { userId: session.user.id, deletedAt: null },
      select: { tags: true },
    }),
  ]);

  const folders = allFoldersRaw
    .map((r) => r.folder)
    .filter((f): f is string => typeof f === 'string')
    .sort((a, b) => a.localeCompare(b));

  const tagCounts = new Map<string, number>();
  for (const r of allTagsRaw) {
    for (const t of decodeTags(r.tags)) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const tags = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // TM-108 — apply in-memory FTS filter + pagination when `q` is set.
  let filteredAssets = assets;
  let effectiveTotal = total;
  if (useFts) {
    const matches = assets.filter((a) => {
      const hay =
        `${a.title ?? ''}\n${a.code ?? ''}\n${a.parameters ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
    effectiveTotal = matches.length;
    const start = (page - 1) * pageSize;
    filteredAssets = matches.slice(start, start + pageSize);
  }

  // Decode tags per row before returning so clients never deal with the JSON
  // string column directly.
  const decoded = filteredAssets.map((a) => ({
    ...a,
    tags: decodeTags(a.tags),
  }));

  return NextResponse.json({
    assets: decoded,
    pagination: {
      page,
      pageSize,
      total: effectiveTotal,
      totalPages: Math.max(1, Math.ceil(effectiveTotal / pageSize)),
    },
    facets: { folders, tags },
  });
}
