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

  const [total, assets, allFoldersRaw, allTagsRaw] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
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

  // Decode tags per row before returning so clients never deal with the JSON
  // string column directly.
  const decoded = assets.map((a) => ({
    ...a,
    tags: decodeTags(a.tags),
  }));

  return NextResponse.json({
    assets: decoded,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    facets: { folders, tags },
  });
}
