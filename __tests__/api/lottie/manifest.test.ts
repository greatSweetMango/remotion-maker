/**
 * TM-189 — coverage hot-spot: GET /api/lottie/manifest (TM-146 / ADR-0027 §3).
 *
 * Mirrors the audio-manifest smoke test (TM-130). Validates the route maps
 * the curated catalogue into the client picker shape, strips `sha256`,
 * emits a cache-control header, and surfaces loader failures as a 500.
 */
import { GET } from '@/app/api/lottie/manifest/route';

describe('GET /api/lottie/manifest', () => {
  it('returns version + assets shaped for the customize picker', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: number;
      assets: Array<Record<string, unknown>>;
    };
    expect(typeof body.version).toBe('number');
    expect(Array.isArray(body.assets)).toBe(true);
    expect(body.assets.length).toBeGreaterThan(0);
    for (const a of body.assets) {
      expect(typeof a.filename).toBe('string');
      expect(typeof a.subject).toBe('string');
      expect(typeof a.motion).toBe('string');
      expect(typeof a.durationFrames).toBe('number');
      expect(typeof a.fps).toBe('number');
      expect(typeof a.license).toBe('string');
      // sha256 is intentionally absent from the public payload
      expect(a.sha256).toBeUndefined();
    }
  });

  it('emits a cache-control header (route is force-static + revalidated)', async () => {
    const res = await GET();
    expect(res.headers.get('cache-control')).toMatch(/s-maxage/);
  });
});

describe('GET /api/lottie/manifest — loader failure', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@/lib/lottie/manifest-loader');
  });

  it('returns 500 with the error message when the loader throws', async () => {
    jest.resetModules();
    jest.doMock('@/lib/lottie/manifest-loader', () => ({
      loadLottieManifest: jest.fn().mockRejectedValue(new Error('boom')),
    }));
    const { GET: GETisolated } = await import('@/app/api/lottie/manifest/route');
    const res = await GETisolated();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('boom');
  });
});
