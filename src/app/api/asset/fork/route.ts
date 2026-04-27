import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

/**
 * POST /api/asset/fork
 *
 * Body: { slug: string }   — the public share slug of the source asset.
 *
 * Effect: copy the source asset's code / jsCode / parameters / dimensions into
 * a brand-new Asset owned by the current user, recording lineage via
 * `sourceAssetId`. The new asset is private (no publicSlug, no sharedAt) —
 * the forker can re-share explicitly later.
 *
 * Auth: required. Returns 401 with `{ error, requiresAuth: true }` so the
 * client can route the user through /login with a callbackUrl that resumes
 * the fork after sign-in.
 *
 * Response: { id, title, sourceAssetId }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Authentication required to fork.', requiresAuth: true },
      { status: 401 },
    );
  }

  let slug: string | undefined;
  try {
    const body = (await req.json()) as { slug?: unknown };
    if (typeof body.slug === 'string' && body.slug.length > 0) {
      slug = body.slug;
    }
  } catch {
    // fall through — slug is required, handled below
  }

  if (!slug) {
    return NextResponse.json(
      { error: 'Missing required field: slug' },
      { status: 400 },
    );
  }

  const source = await prisma.asset.findUnique({
    where: { publicSlug: slug },
    select: {
      id: true,
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

  if (!source) {
    return NextResponse.json(
      { error: 'Shared asset not found or no longer public.' },
      { status: 404 },
    );
  }

  const forkedTitle = source.title.endsWith(' (forked)')
    ? source.title
    : `${source.title} (forked)`;

  const forked = await prisma.asset.create({
    data: {
      userId: session.user.id,
      title: forkedTitle,
      code: source.code,
      jsCode: source.jsCode,
      parameters: source.parameters,
      durationInFrames: source.durationInFrames,
      fps: source.fps,
      width: source.width,
      height: source.height,
      sourceAssetId: source.id,
      // publicSlug + sharedAt remain null — fork is private until re-shared.
    },
    select: { id: true, title: true, sourceAssetId: true },
  });

  return NextResponse.json(forked, { status: 201 });
}
