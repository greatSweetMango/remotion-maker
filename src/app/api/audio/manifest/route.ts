/**
 * GET /api/audio/manifest — TM-130 / ADR-0026 §4.
 *
 * Exposes the curated BGM catalogue (filename + mood + bpm + duration) to the
 * Customize panel so the `bgmTrack` PARAMS dropdown can render a grouped list
 * with in-place play/pause preview. Public on purpose — the same list ships
 * inside the LLM system prompt anyway, and the audio files themselves are
 * served as `/audio/<name>.mp3` static assets without auth.
 *
 * Cached at the edge: the manifest only changes when we re-curate the
 * catalogue (a deploy event), so a long s-maxage is safe. We strip `sha256`
 * because the client doesn't need it for picker UX and exposing it has no
 * security upside.
 */
import { NextResponse } from 'next/server';
// TM-133: `loadAudioManifest` lives in the server-only loader (it touches
// `node:fs/promises`). The route handler runs in node, so we import it
// directly. `AudioTrack` is a pure type and can come from either module —
// take it from the client-safe types module.
import { loadAudioManifest } from '@/lib/audio/manifest-loader';
import type { AudioTrack } from '@/lib/audio/manifest-types';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600;

export interface ClientAudioTrack {
  filename: string;
  mood: AudioTrack['mood'];
  bpm: number;
  durationSec: number;
  license: string;
  attribution?: string;
}

export async function GET() {
  try {
    const manifest = await loadAudioManifest();
    const tracks: ClientAudioTrack[] = manifest.tracks.map(t => ({
      filename: t.filename,
      mood: t.mood,
      bpm: t.bpm,
      durationSec: t.durationSec,
      license: t.license,
      ...(t.attribution ? { attribution: t.attribution } : {}),
    }));
    return NextResponse.json(
      { version: manifest.version, tracks },
      { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'failed to load manifest' },
      { status: 500 },
    );
  }
}
