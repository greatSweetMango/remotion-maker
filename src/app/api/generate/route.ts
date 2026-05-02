import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { AiRefusalError } from '@/lib/ai/refusal';
import { getModels } from '@/lib/ai/client';
import { TIER_LIMITS } from '@/lib/usage';
import { validatePrompt } from '@/lib/validation/prompt';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate input shape BEFORE any DB / quota work. TM-58 length cap.
  const body = await req.json();
  const { prompt, answers } = body as { prompt?: string; answers?: Record<string, string> };
  const promptError = validatePrompt(prompt);
  if (promptError || typeof prompt !== 'string') {
    const err = promptError ?? { message: 'Prompt required', code: 'PROMPT_REQUIRED' as const, status: 400 as const };
    return NextResponse.json(
      { error: err.message, code: err.code, ...((promptError?.meta) ?? {}) },
      { status: err.status },
    );
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

  // TM-92 — atomically reserve a quota slot BEFORE the LLM call.
  //
  // Previously this route did `findUnique → in-memory compare → generateAsset → update`,
  // which is a TOCTOU race: N concurrent FREE requests at usage=0 all read 0, all
  // pass the gate, all increment to N. SQLite + Prisma do not serialize this.
  //
  // The fix is a single conditional `updateMany` whose `where` includes the cap.
  // SQLite executes this as one atomic statement, so exactly `limit - usage` of
  // the burst will see `count: 1`; the rest see `count: 0` and are rejected.
  // Refunds happen on the no-charge paths (clarify, refusal) below.
  const limit = TIER_LIMITS[user.tier].monthlyGenerations;
  const reserved = await prisma.user.updateMany({
    where: { id: user.id, monthlyUsage: { lt: limit } },
    data: { monthlyUsage: { increment: 1 } },
  });
  if (reserved.count === 0) {
    return NextResponse.json(
      {
        error: `Monthly generation limit reached (${limit}). ${
          user.tier === 'FREE' ? 'Upgrade to Pro for 200/month.' : 'Purchase additional credits.'
        }`,
      },
      { status: 429 },
    );
  }

  const models = getModels();
  const model = user.tier === 'PRO' ? models.pro : models.free;
  console.log(`[generate] tier=${user.tier} model=${model} usage=${user.monthlyUsage}`);

  try {
    const generateStart = Date.now();
    let firstTokenMs = -1;
    const result = await generateAsset(prompt, model, {
      answers,
      onFirstToken: (ms) => {
        firstTokenMs = ms;
        // TM-54 — first-byte observability for the route. Helps correlate
        // server-side TTFB with client-perceived latency (acceptance: p50 ≤ 5s).
        console.log(`[generate] firstTokenMs=${ms} model=${model} tier=${user.tier}`);
      },
    });
    const totalMs = Date.now() - generateStart;
    console.log(
      `[generate] done totalMs=${totalMs} firstTokenMs=${firstTokenMs} type=${result.type}`,
    );

    // Clarify-only response: do NOT consume monthly quota. We already reserved
    // a slot above; refund it here so clarify rounds remain free.
    if (result.type === 'clarify') {
      await prisma.user.update({
        where: { id: user.id },
        data: { monthlyUsage: { decrement: 1 } },
      });
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

    // Quota was already reserved before generation — no second increment here.
    return NextResponse.json({ type: 'generate', asset: { ...asset, id: dbAsset.id } });
  } catch (error: unknown) {
    // TM-59 — adversarial / safety / policy refusals surface as 400 with a
    // category code so the UI can show a clearer toast. We do NOT consume
    // monthly quota for these (no asset was created above this point), so
    // refund the slot reserved at the top of the handler.
    if (error instanceof AiRefusalError) {
      await prisma.user.update({
        where: { id: user.id },
        data: { monthlyUsage: { decrement: 1 } },
      });
      console.warn(
        `[generate] refusal category=${error.category} hint=${error.matchedHint ?? '-'} tier=${user.tier}`,
      );
      return NextResponse.json(
        { error: error.message, code: error.code, category: error.category },
        { status: 400 },
      );
    }
    // Unexpected failure: also refund so a 500 doesn't burn the user's quota.
    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: { decrement: 1 } },
    });
    console.error('Generation error:', error);
    const msg = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
