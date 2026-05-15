/**
 * TM-147 / ADR-0027 §4 — public/lottie/ bundle + Lottie render smoke.
 *
 * Verifies the ADR-0027 claim: `<CatalogueLottie>` round-trips through
 * the Remotion bundler / renderer. The Lambda export path uses the same
 * `staticFile` semantics as the local renderer, so a regression in
 * either path surfaces here.
 *
 * Contract:
 *   1. Bundle a composition that renders `<CatalogueLottie asset="lottie/bear-walk.json">`.
 *   2. `renderMedia` to mp4 with codec=h264 — the Lottie loop should
 *      animate per-frame deterministically.
 *   3. Probe the output mp4: confirm a video stream exists, duration
 *      matches the composition span (5.0s @ 30fps, ±0.2s tolerance).
 *   4. Sanity-check that the catalogue JSON was actually fetched: read
 *      first vs last frame bytes and assert they differ (the bear-walk
 *      animation MUST move; if `staticFile()` resolved to nothing, the
 *      wrapper would render `null` and every frame would be the
 *      identical solid background).
 *
 * Slow (~60-90s: webpack bundle + h264 render of an animated tree).
 * Opt-in via REMOTION_BUNDLE_TEST=1 mirroring TM-89 / TM-131. ffprobe is
 * preferred for the video-stream / duration checks; absent ffprobe we
 * fall back to a byte-level mp4 sniff so the test still has signal in
 * CI images without ffmpeg.
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

interface VideoProbe {
  hasVideo: boolean;
  durationSec: number | null;
  codec: string | null;
  width: number | null;
  height: number | null;
}

function probeVideoWithFfprobe(file: string): VideoProbe {
  const r = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,duration,width,height',
      '-of', 'default=nw=1',
      file,
    ],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    return { hasVideo: false, durationSec: null, codec: null, width: null, height: null };
  }
  const out = r.stdout || '';
  const codec = (out.match(/codec_name=(\S+)/) || [])[1] || null;
  const dur = (out.match(/duration=([\d.]+)/) || [])[1];
  const w = (out.match(/width=(\d+)/) || [])[1];
  const h = (out.match(/height=(\d+)/) || [])[1];
  return {
    hasVideo: !!codec,
    durationSec: dur ? Number(dur) : null,
    codec,
    width: w ? Number(w) : null,
    height: h ? Number(h) : null,
  };
}

async function sniffVideoAtomFallback(file: string): Promise<boolean> {
  // Last-resort video detection. h264-in-mp4 places the codec marker
  // (`avc1`) and the visual handler (`vide`) within the moov atom — both
  // appear in the first few MB.
  const buf = await fs.readFile(file);
  const slice = buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024));
  const text = slice.toString('binary');
  return text.includes('avc1') || text.includes('vide');
}

d('TM-147 lottie bundle smoke', () => {
  jest.setTimeout(240_000);

  let tmpDir: string;
  let outPath: string;
  let frame0Path: string;
  let frame149Path: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm147-'));
    outPath = path.join(tmpDir, 'lottie-smoke.mp4');
    frame0Path = path.join(tmpDir, 'frame-0.png');
    frame149Path = path.join(tmpDir, 'frame-149.png');
  });

  afterAll(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('bundles public/lottie/ and renders an animated CatalogueLottie composition', async () => {
    const { bundle } = await import('@remotion/bundler');
    const { selectComposition, renderMedia, renderStill } = await import(
      '@remotion/renderer'
    );

    const entryPoint = path.resolve(
      process.cwd(),
      '__tests__/api/export/lottie-bundle-entry.tsx'
    );

    // CatalogueLottie imports from `@/lib/lottie/manifest-types` so we
    // need the `@/*` alias in webpack — same shape as TM-89 bundle test.
    const serveUrl = await bundle({
      entryPoint,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: {
            ...(config.resolve?.alias || {}),
            '@': path.resolve(process.cwd(), 'src'),
          },
        },
      }),
    });

    const composition = await selectComposition({
      serveUrl,
      id: 'LottieBundleSmoke',
    });

    expect(composition.id).toBe('LottieBundleSmoke');
    expect(composition.durationInFrames).toBe(150);
    expect(composition.fps).toBe(30);
    expect(composition.width).toBe(640);
    expect(composition.height).toBe(360);

    // Render two stills (frame 0 vs final frame) to prove the Lottie
    // animation actually advances. If `staticFile("lottie/bear-walk.json")`
    // failed to resolve in the bundle, CatalogueLottie would render `null`
    // and both stills would be identical solid backgrounds.
    await renderStill({
      composition,
      serveUrl,
      output: frame0Path,
      frame: 0,
    });
    await renderStill({
      composition,
      serveUrl,
      output: frame149Path,
      frame: 149,
    });

    const frame0 = await fs.readFile(frame0Path);
    const frame149 = await fs.readFile(frame149Path);
    expect(frame0.length).toBeGreaterThan(1000);
    expect(frame149.length).toBeGreaterThan(1000);
    // The two PNGs MUST differ — proves the catalogue JSON was fetched
    // and animated by lottie-web. (A null render of a solid background
    // produces byte-identical PNGs at any frame.)
    expect(frame0.equals(frame149)).toBe(false);

    // Now render the full mp4 to exercise the Lambda-equivalent codepath.
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outPath,
    });

    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(10_000);

    if (ffprobeAvailable()) {
      const probe = probeVideoWithFfprobe(outPath);
      expect(probe.hasVideo).toBe(true);
      expect(probe.codec).toMatch(/^(h264|avc1)$/);
      expect(probe.width).toBe(640);
      expect(probe.height).toBe(360);
      // 5.0s composition; tolerance covers container vs stream rounding.
      expect(probe.durationSec).not.toBeNull();
      expect(probe.durationSec!).toBeGreaterThan(4.8);
      expect(probe.durationSec!).toBeLessThan(5.2);
    } else {
      const looksVideo = await sniffVideoAtomFallback(outPath);
      expect(looksVideo).toBe(true);
      console.warn(
        'TM-147: ffprobe not available — used mp4-atom byte-sniff fallback. '
          + 'Install ffmpeg for stronger duration/codec assertions.'
      );
    }
  });
});
