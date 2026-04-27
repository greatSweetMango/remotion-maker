import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { editAsset } from '@/lib/ai/edit';
import { getModels } from '@/lib/ai/client';
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

  const isTemplate = assetId.startsWith('template-');

  const [user, asset] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    isTemplate
      ? Promise.resolve(null)
      : prisma.asset.findFirst({ where: { id: assetId, userId: session.user.id, deletedAt: null } }),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!isTemplate && !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const usageKey = isTemplate ? assetId : assetId;
  const editUsage = JSON.parse(user.editUsage as string) as Record<string, number>;
  const editCount = editUsage[usageKey] || 0;

  const limitCheck = checkEditLimit({ tier: user.tier, editCount });
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 429 });
  }

  const models = getModels();
  const model = user.tier === 'PRO' ? models.pro : models.free;

  try {
    const edited = await editAsset(currentCode, prompt, model);

    let savedAssetId = assetId;

    if (isTemplate) {
      const newAsset = await prisma.asset.create({
        data: {
          userId: user.id,
          title: edited.title,
          code: edited.code,
          jsCode: edited.jsCode,
          parameters: JSON.stringify(edited.parameters),
          durationInFrames: edited.durationInFrames,
          fps: edited.fps,
          width: edited.width,
          height: edited.height,
          versions: {
            create: {
              code: edited.code,
              jsCode: edited.jsCode,
              parameters: JSON.stringify(edited.parameters),
              prompt,
            },
          },
        },
      });
      savedAssetId = newAsset.id;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          monthlyUsage: { increment: 1 },
          editUsage: JSON.stringify({ ...editUsage, [usageKey]: editCount + 1 }),
        },
      });
    } else {
      await prisma.$transaction([
        prisma.assetVersion.create({
          data: {
            assetId,
            code: edited.code,
            jsCode: edited.jsCode,
            parameters: JSON.stringify(edited.parameters),
            prompt,
          },
        }),
        prisma.asset.update({
          where: { id: assetId },
          data: {
            code: edited.code,
            jsCode: edited.jsCode,
            parameters: JSON.stringify(edited.parameters),
            title: edited.title,
          },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: {
            editUsage: JSON.stringify({ ...editUsage, [usageKey]: editCount + 1 }),
          },
        }),
      ]);
    }

    return NextResponse.json({ ...edited, id: savedAssetId });
  } catch (error: unknown) {
    console.error('Edit error:', error);
    const msg = error instanceof Error ? error.message : 'Edit failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
