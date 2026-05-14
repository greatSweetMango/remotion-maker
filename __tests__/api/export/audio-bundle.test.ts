/**
 * TM-131 — public/audio/ bundle + audio-stream determinism smoke.
 *
 * Verifies the ADR-0026 §B Lambda-export claim: "Remotion Lambda already
 * includes `public/audio/` in the deploy bundle via `staticFile`". We exercise
 * the same bundle/render pipeline that powers `/api/export` (TM-89 local
 * renderer; the Lambda path uses identical `staticFile` semantics) so a
 * regression in either codepath surfaces here.
 *
 * Contract:
 *   1. Bundle a composition that references `staticFile("audio/<track>.mp3")`.
 *   2. `renderMedia` to mp4 with codec=h264 — Remotion auto-includes the
 *      audio stream when an <Audio> tag is in the tree.
 *   3. Probe the output mp4: confirm an audio stream exists AND its duration
 *      matches the composition duration (5.0s @ 30fps), within 0.2s tolerance
 *      (Remotion may emit a slightly shorter audio span than the visual
 *      duration when the source clip is longer; we're verifying it didn't
 *      get silently stripped).
 *
 * Slow (~60s: webpack bundle + h264 render). Opt-in via REMOTION_BUNDLE_TEST=1
 * mirroring the TM-89 bundle-entry test pattern. ffprobe is preferred for the
 * audio-stream check; if absent, we fall back to a byte-level mp4 sniff for
 * the `mp4a`/`Audio` atom marker so the test still has signal in CI images
 * without ffmpeg installed.
 */
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { spawnSync } from 'child_process';

const RUN = process.env.REMOTION_BUNDLE_TEST === '1';
const d = RUN ? describe : describe.skip;

function ffprobeAvailable(): boolean {
  const r = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

interface AudioProbe {
  hasAudio: boolean;
  durationSec: number | null;
  codec: string | null;
}

function probeAudioWithFfprobe(file: string): AudioProbe {
  const r = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,duration',
      '-of', 'default=nw=1',
      file,
    ],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) return { hasAudio: false, durationSec: null, codec: null };
  const out = r.stdout || '';
  const codec = (out.match(/codec_name=(\S+)/) || [])[1] || null;
  const dur = (out.match(/duration=([\d.]+)/) || [])[1];
  return {
    hasAudio: !!codec,
    durationSec: dur ? Number(dur) : null,
    codec,
  };
}

async function sniffAudioAtomFallback(file: string): Promise<boolean> {
  // Last-resort audio detection: scan the first few MB of the mp4 for either
  // the `mp4a` (AAC sample entry) or `soun` (audio handler) atom marker.
  // Not as reliable as ffprobe but distinguishes "rendered with audio" from
  // "rendered without audio" in environments missing ffmpeg.
  const buf = await fs.readFile(file);
  const slice = buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024));
  const text = slice.toString('binary');
  return text.includes('mp4a') || text.includes('soun');
}

d('TM-131 audio bundle smoke', () => {
  jest.setTimeout(180_000);

  let tmpDir: string;
  let outPath: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm131-'));
    outPath = path.join(tmpDir, 'audio-smoke.mp4');
  });

  afterAll(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('bundles public/audio/ and emits an mp4 with an audio stream', async () => {
    const { bundle } = await import('@remotion/bundler');
    const { selectComposition, renderMedia } = await import('@remotion/renderer');

    const entryPoint = path.resolve(
      process.cwd(),
      '__tests__/api/export/audio-bundle-entry.tsx'
    );

    const serveUrl = await bundle({
      entryPoint,
      // No `@/*` alias needed — this entry imports only from `remotion`.
    });

    const composition = await selectComposition({
      serveUrl,
      id: 'AudioBundleSmoke',
    });

    expect(composition.id).toBe('AudioBundleSmoke');
    expect(composition.durationInFrames).toBe(150);
    expect(composition.fps).toBe(30);

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outPath,
    });

    // File exists and is non-trivial.
    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(10_000);

    if (ffprobeAvailable()) {
      const probe = probeAudioWithFfprobe(outPath);
      expect(probe.hasAudio).toBe(true);
      // Remotion emits AAC for h264/mp4 by default.
      expect(probe.codec).toMatch(/^(aac|mp3)$/);
      // Composition is 5.0s; audio span should be in [4.8, 5.2].
      // (Remotion clamps audio to the composition duration.)
      expect(probe.durationSec).not.toBeNull();
      expect(probe.durationSec!).toBeGreaterThan(4.8);
      expect(probe.durationSec!).toBeLessThan(5.2);
    } else {
      // Fallback: byte-sniff the mp4 for an audio atom marker.
      const looksAudible = await sniffAudioAtomFallback(outPath);
      expect(looksAudible).toBe(true);
      console.warn(
        'TM-131: ffprobe not available — used mp4-atom byte-sniff fallback. '
          + 'Install ffmpeg for stronger duration assertions.'
      );
    }
  });
});
