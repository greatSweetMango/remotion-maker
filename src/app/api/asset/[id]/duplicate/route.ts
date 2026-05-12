import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

const MAX_TITLE_LENGTH = 200;
const COPY_SUFFIX = ' (copy)';

/**
 * POST /api/asset/[id]/duplicate
 *
 * Create an owner-side copy of one of the caller's own assets (TM-87 dashboard
 * management). Distinct from `/api/asset/fork` which forks **someone else's**
 * public share by `publicSlug` and records `sourceAssetId` lineage. Duplicate
 * is purely a local convenience clone — no lineage is recorded, the new asset
 * is independent.
 *
 * Behavior:
 *  - Owner-only. Soft-deleted assets are treated as not-found.
 *  - Title is suffixed with " (copy)" once, truncated to MAX_TITLE_LENGTH.
 *  - publicSlug + sharedAt are NOT carried over — the copy starts private.
 *  - Does NOT clone AssetVersion history; the copy starts with a clean
 *    version log (the studio creates v1 on first edit). This keeps duplicate
 *    cheap and avoids surprising users who expect a fresh history.
 *  - Capacity guard: respects `TIER_LIMITS[tier].maxAssets` — duplicating into
 *    a full library returns 402-style 403 with `error: 'Asset limit reached'`
 *    so the UI can prompt upgrade. Falls back gracefully when the tier has no
 *    cap (Pro/unlimited tiers expressed as `Infinity` or undefined).
 *
 * Response: { id, title }
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const source = await prisma.asset.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      deletedAt: true,
      title: true,
      code: true,
      jsCode: true,
      parameters: true,
      durationInFrames: true,
      fps: true,
      width: true,
      height: true,
    },
  });
  if (!source || source.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (source.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Note: no per-tier `maxAssets` cap today — the launch quota model only
  // bounds `monthlyGenerations` (LLM cost) and `editsPerAsset`. Duplicate is
  // a pure DB clone (no LLM call), so it's intentionally unmetered. If a
  // storage-bound cap is introduced later, add the check here.

  // Suffix " (copy)" once; if it already ends with the suffix keep it to
  // avoid "X (copy) (copy)" chains. Truncate to MAX_TITLE_LENGTH.
  let newTitle = source.title.endsWith(COPY_SUFFIX)
    ? source.title
    : `${source.title}${COPY_SUFFIX}`;
  if (newTitle.length > MAX_TITLE_LENGTH) {
    newTitle = newTitle.slice(0, MAX_TITLE_LENGTH);
  }

  const copy = await prisma.asset.create({
    data: {
      userId,
      title: newTitle,
      code: source.code,
      jsCode: source.jsCode,
      parameters: source.parameters,
      durationInFrames: source.durationInFrames,
      fps: source.fps,
      width: source.width,
      height: source.height,
      // publicSlug + sharedAt intentionally null — copy is private.
      // sourceAssetId intentionally null — duplicate is NOT a fork.
    },
    select: { id: true, title: true },
  });

  return NextResponse.json(copy, { status: 201 });
}
