/**
 * GET /api/lottie/manifest — TM-146 / ADR-0027 §3.
 *
 * Exposes the curated Lottie catalogue (filename + subject + motion +
 * duration) to the Customize panel so the `lottie` PARAMS dropdown can
 * render a grouped list (by `subject`) with a static-thumbnail preview.
 *
 * Mirrors the audio-manifest route (TM-130) on purpose: same caching,
 * same public-by-design rationale (the same listing already ships in
 * the LLM system prompt and the assets are served as `/lottie/<name>.json`
 * static files without auth).
 *
 * `sha256` is stripped — the client doesn't need it for picker UX and
 * exposing it has no security upside.
 */
import { NextResponse } from 'next/server';
// TM-140: `loadLottieManifest` lives in the server-only loader (it
// touches `node:fs/promises`). The route handler runs in node, so we
// import it directly. `LottieAsset` is a pure type and can come from
// either module — take it from the client-safe types module.
import { loadLottieManifest } from '@/lib/lottie/manifest-loader';
import type { LottieAsset } from '@/lib/lottie/manifest-types';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600;

export interface ClientLottieAsset {
  filename: string;
  subject: string;
  motion: string;
  durationFrames: number;
  fps: number;
  license: string;
  attribution?: string;
}

export async function GET() {
  try {
    const manifest = await loadLottieManifest();
    const assets: ClientLottieAsset[] = manifest.assets.map((a: LottieAsset) => ({
      filename: a.filename,
      subject: a.subject,
      motion: a.motion,
      durationFrames: a.durationFrames,
      fps: a.fps,
      license: a.license,
      ...(a.attribution ? { attribution: a.attribution } : {}),
    }));
    return NextResponse.json(
      { version: manifest.version, assets },
      { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'failed to load manifest' },
      { status: 500 },
    );
  }
}
