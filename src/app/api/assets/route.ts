import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';

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

  const [total, assets] = await Promise.all([
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
  ]);

  return NextResponse.json({
    assets,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}
