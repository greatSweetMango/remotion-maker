import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { getModels } from '@/lib/ai/client';
import { checkGenerationLimit } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const now = new Date();
  const resetAt = new Date(user.usageResetAt);
  if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: 0, usageResetAt: now, editUsage: '{}' },
    });
    user.monthlyUsage = 0;
  }

  const limitCheck = checkGenerationLimit({ tier: user.tier, monthlyUsage: user.monthlyUsage });
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 429 });
  }

  const body = await req.json();
  const { prompt, answers } = body as { prompt?: string; answers?: Record<string, string> };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
  }

  const models = getModels();
  const model = user.tier === 'PRO' ? models.pro : models.free;
  console.log(`[generate] tier=${user.tier} model=${model} usage=${user.monthlyUsage}`);

  try {
    const result = await generateAsset(prompt, model, { answers });

    // Clarify-only response: do NOT consume monthly quota.
    if (result.type === 'clarify') {
      return NextResponse.json({ type: 'clarify', questions: result.questions });
    }

    const asset = result.asset;

    const dbAsset = await prisma.asset.create({
      data: {
        userId: user.id,
        title: asset.title,
        code: asset.code,
        jsCode: asset.jsCode,
        parameters: JSON.stringify(asset.parameters),
        durationInFrames: asset.durationInFrames,
        fps: asset.fps,
        width: asset.width,
        height: asset.height,
        versions: {
          create: {
            code: asset.code,
            jsCode: asset.jsCode,
            parameters: JSON.stringify(asset.parameters),
            prompt,
          },
        },
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: { increment: 1 } },
    });

    return NextResponse.json({ type: 'generate', asset: { ...asset, id: dbAsset.id } });
  } catch (error: unknown) {
    console.error('Generation error:', error);
    const msg = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
