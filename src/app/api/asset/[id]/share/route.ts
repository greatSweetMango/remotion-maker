import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generatePublicSlug } from '@/lib/share/slug';

/**
 * POST /api/asset/[id]/share
 *
 * Enable a public read-only share link for an asset owned by the current user.
 * Idempotent — returns the existing slug if one already exists.
 *
 * Auth: required (NextAuth session). Caller must own the asset.
 *
 * Response: { slug, url, sharedAt }
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, userId: true, publicSlug: true, sharedAt: true, deletedAt: true },
  });

  if (!asset || asset.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (asset.publicSlug) {
    return NextResponse.json({
      slug: asset.publicSlug,
      url: `/share/${asset.publicSlug}`,
      sharedAt: asset.sharedAt,
    });
  }

  // Generate a fresh slug. Retry on the (extremely unlikely) unique-constraint clash.
  let attempt = 0;
  while (attempt < 5) {
    const slug = generatePublicSlug();
    try {
      const updated = await prisma.asset.update({
        where: { id: asset.id },
        data: { publicSlug: slug, sharedAt: new Date() },
        select: { publicSlug: true, sharedAt: true },
      });
      return NextResponse.json({
        slug: updated.publicSlug,
        url: `/share/${updated.publicSlug}`,
        sharedAt: updated.sharedAt,
      });
    } catch (err: unknown) {
      // P2002 = unique constraint violation. Retry with a new slug.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  return NextResponse.json(
    { error: 'Could not allocate slug, please retry' },
    { status: 503 }
  );
}

/**
 * DELETE /api/asset/[id]/share
 *
 * Revoke the public share link. Idempotent.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.asset.update({
    where: { id },
    data: { publicSlug: null, sharedAt: null },
  });

  return NextResponse.json({ ok: true });
}
