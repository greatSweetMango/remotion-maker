import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { editAsset } from '@/lib/ai/edit';
import { checkEditLimit } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId, prompt, currentCode } = await req.json();
  if (!assetId || !prompt || !currentCode) {
    return NextResponse.json({ error: 'assetId, prompt, and currentCode required' }, { status: 400 });
  }

  const [user, asset] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    prisma.asset.findUnique({ where: { id: assetId, userId: session.user.id } }),
  ]);

  if (!user || !asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const editUsage = (user.editUsage as Record<string, number>) || {};
  const editCount = editUsage[assetId] || 0;

  const limitCheck = checkEditLimit({ tier: user.tier, editCount });
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 429 });
  }

  const model = user.tier === 'PRO' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  try {
    const edited = await editAsset(currentCode, prompt, model);

    await prisma.$transaction([
      prisma.assetVersion.create({
        data: {
          assetId,
          code: edited.code,
          jsCode: edited.jsCode,
          parameters: edited.parameters as never,
          prompt,
        },
      }),
      prisma.asset.update({
        where: { id: assetId },
        data: {
          code: edited.code,
          jsCode: edited.jsCode,
          parameters: edited.parameters as never,
          title: edited.title,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          editUsage: { ...editUsage, [assetId]: editCount + 1 },
        },
      }),
    ]);

    return NextResponse.json({ ...edited, id: assetId });
  } catch (error: unknown) {
    console.error('Edit error:', error);
    const msg = error instanceof Error ? error.message : 'Edit failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
