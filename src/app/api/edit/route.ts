import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { editAsset } from '@/lib/ai/edit';
import { getModels } from '@/lib/ai/client';
import { TIER_LIMITS, reserveEditSlot, refundEditSlot, isValidAssetIdForUsageKey } from '@/lib/usage';
import { validatePrompt } from '@/lib/validation/prompt';

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

  // TM-58 prompt length cap. Apply BEFORE editAsset call to avoid token-cost amplification.
  const promptError = validatePrompt(prompt);
  if (promptError) {
    return NextResponse.json(
      { error: promptError.message, code: promptError.code, ...(promptError.meta ?? {}) },
      { status: promptError.status },
    );
  }

  const isTemplate = (assetId as string).startsWith('template-');

  // TM-93 — assetId is the JSON-path key for the editUsage counter. Reject
  // weird input *before* any DB call so we never feed it into the raw
  // `json_extract($.<key>)` UPDATE. (cuids and `template-<cuid>` pass.)
  if (!isValidAssetIdForUsageKey(assetId)) {
    return NextResponse.json({ error: 'invalid assetId' }, { status: 400 });
  }

  const [user, asset, alreadyMaterialized] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    isTemplate
      ? Promise.resolve(null)
      : prisma.asset.findFirst({ where: { id: assetId, userId: session.user.id, deletedAt: null } }),
    // TM-109 — server-side guard: if this user has previously materialized
    // *this* template (template-<id>), reuse the existing Asset row instead
    // of creating a duplicate. Prevents `monthlyUsage` from being charged
    // more than once per template per user, even if the client (buggy or
    // malicious) keeps re-sending `assetId: "template-…"` after the first
    // edit. The TM-106 client fix already pivots `state.asset.id` for the
    // happy path; this is the defence-in-depth.
    isTemplate
      ? prisma.asset.findFirst({
          where: {
            userId: session.user.id,
            templateSourceId: assetId,
            deletedAt: null,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!isTemplate && !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  // TM-109 — when the template has already been materialized for this user,
  // pivot the usage key (and downstream writes) onto the existing asset's
  // real id. The reservation, refund, asset.update, and assetVersion.create
  // all key off this real id from here on.
  const templateSourceId = isTemplate ? assetId : null;
  const effectiveAssetId = alreadyMaterialized?.id ?? assetId;
  const usageKey = effectiveAssetId;

  // TM-93 — atomically reserve one edit slot BEFORE the LLM call. Previously
  // this route did findUnique → JSON.parse → compare → editAsset → update,
  // the exact TOCTOU pattern fixed in /api/generate by TM-92. Concurrent
  // edits on the same FREE asset all read editCount=N, all passed the
  // gate, and all incremented to >limit. The new path uses a single atomic
  // SQLite UPDATE with `json_extract` precondition — exactly `limit` of any
  // burst observe `affected = 1`; the rest see 0 and fall through to 429.
  // Refund happens on the LLM-failure path below so 5xx doesn't burn quota.
  const limit = TIER_LIMITS[user.tier].editsPerAsset;
  const reserved = await reserveEditSlot({ userId: user.id, assetId: usageKey, limit });
  if (!reserved) {
    return NextResponse.json(
      {
        error: `Edit limit reached (${limit} per asset on Free plan). Upgrade to Pro for unlimited edits.`,
      },
      { status: 429 },
    );
  }

  const models = getModels();
  const model = user.tier === 'PRO' ? models.pro : models.free;

  try {
    const edited = await editAsset(currentCode, prompt, model);

    let savedAssetId = effectiveAssetId;

    if (isTemplate && !alreadyMaterialized) {
      // First materialization of this template for this user — create a new
      // Asset row, stamp `templateSourceId` so future `template-…` edits hit
      // the TM-109 guard, and bump monthlyUsage (this is the *one* time the
      // user is charged a generation slot for adopting the template).
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
          templateSourceId,
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

      // monthlyUsage bumps EXACTLY once per template per user — on the
      // first materialization. editUsage was already incremented atomically
      // by reserveEditSlot above (under the new asset's id, not the
      // template- prefix, thanks to TM-106 client pivot — but if the client
      // is misbehaving and keeps sending `template-…`, the `usageKey`
      // already points at `effectiveAssetId === assetId`, so subsequent
      // requests still hit this branch only when no prior materialization
      // exists for THIS template).
      await prisma.user.update({
        where: { id: user.id },
        data: {
          monthlyUsage: { increment: 1 },
        },
      });
    } else {
      // Either:
      //   (a) plain edit on an owned cuid asset, OR
      //   (b) TM-109 guarded re-entry — client sent `template-…` but we
      //       already have a materialized row, so we transparently edit
      //       that row and DO NOT bump monthlyUsage.
      // editUsage already incremented atomically above (TM-93). Transaction
      // here only covers the version+asset writes.
      await prisma.$transaction([
        prisma.assetVersion.create({
          data: {
            assetId: effectiveAssetId,
            code: edited.code,
            jsCode: edited.jsCode,
            parameters: JSON.stringify(edited.parameters),
            prompt,
          },
        }),
        prisma.asset.update({
          where: { id: effectiveAssetId },
          data: {
            code: edited.code,
            jsCode: edited.jsCode,
            parameters: JSON.stringify(edited.parameters),
            title: edited.title,
          },
        }),
      ]);
    }

    return NextResponse.json({ ...edited, id: savedAssetId });
  } catch (error: unknown) {
    // TM-93 — refund the slot we reserved before the LLM call so a 5xx (or
    // any post-reserve failure) doesn't permanently consume the user's edit
    // quota. Mirrors TM-92's monthlyUsage refund on /api/generate failure.
    await refundEditSlot({ userId: user.id, assetId: usageKey }).catch(() => {});
    console.error('Edit error:', error);
    const msg = error instanceof Error ? error.message : 'Edit failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
