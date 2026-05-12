/**
 * POST /api/asset/regen-image — TM-88 / ADR-0022 follow-up.
 *
 * Customize-tab "Regenerate" button for `type:image` PARAMS. Takes a (possibly
 * user-edited) prompt, calls `generateAssetImage` (gpt-image-1, see TM-84
 * spike), and returns a fresh `imageUrl` (data URL) the client can drop into
 * `paramValues[key]`.
 *
 * Auth: required.
 *
 * Per-call cost guard: gpt-image-1 standard 1024² ≈ $0.04. We additionally
 * enforce that the caller is on PRO tier (per ADR-0022 결정 §1: free tier =
 * catalog/option-A only). FREE users get a 403 with an upgrade hint.
 *
 * Scope (TM-88 only):
 * - No R2 persistence. Returned `dataUrl` is the canonical URL the client
 *   stores in `paramValues`. R2 caching is a separate follow-up.
 * - No NSFW filter beyond OpenAI's built-in moderation (which raises 400 from
 *   the SDK — we propagate the message verbatim).
 * - No spend ledger integration (recordUsage only knows token-based pricing
 *   today; image-gen flat-rate accounting is tracked via response.costUsd
 *   and surfaced to the client for telemetry).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAssetImage, GPT_IMAGE_1_PRICE_USD_1024 } from '@/lib/ai/asset-gen';
import { validatePrompt } from '@/lib/validation/prompt';

export const runtime = 'nodejs';

interface RegenBody {
  prompt?: unknown;
  /** PARAMS key being regenerated — purely echoed back for the client to route the response. */
  paramKey?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RegenBody;
  try {
    body = (await req.json()) as RegenBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.prompt !== 'string') {
    return NextResponse.json({ error: 'prompt (string) required' }, { status: 400 });
  }
  const prompt = body.prompt;
  const paramKey = typeof body.paramKey === 'string' ? body.paramKey : null;

  const promptError = validatePrompt(prompt);
  if (promptError) {
    return NextResponse.json(
      { error: promptError.message, code: promptError.code, ...(promptError.meta ?? {}) },
      { status: promptError.status },
    );
  }

  // ADR-0022: image-gen is PRO-only. Free tier stays on catalog/option-A,
  // so the regen button must not be callable from a Free account.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { tier: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (user.tier !== 'PRO') {
    return NextResponse.json(
      {
        error: 'Image regeneration is a Pro feature.',
        upgradeRequired: true,
      },
      { status: 403 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    // Fail loud — without the key the call would throw inside the SDK with a
    // less actionable message. This branch is exercised in CI where the key
    // is intentionally absent.
    return NextResponse.json(
      { error: 'Image generation is not configured (OPENAI_API_KEY missing).' },
      { status: 503 },
    );
  }

  try {
    const result = await generateAssetImage({ prompt });
    return NextResponse.json({
      paramKey,
      imageUrl: result.dataUrl,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      size: result.size,
      quality: result.quality,
      // Echo so client can show "Used prompt: …" in the success toast and
      // optionally re-prefill on next regen.
      prompt: result.prompt,
      pricePerImageUsd: GPT_IMAGE_1_PRICE_USD_1024,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'image generation failed';
    // OpenAI moderation rejects (e.g. real-person prompts) surface as
    // `BadRequestError` from the SDK; we map to 422 so the client can show
    // an inline error without redirecting to the generic 5xx flow.
    const isModeration = /content_policy|moderation|safety|policy/i.test(message);
    return NextResponse.json(
      { error: message, code: isModeration ? 'CONTENT_POLICY' : 'IMAGE_GEN_FAILED' },
      { status: isModeration ? 422 : 502 },
    );
  }
}
