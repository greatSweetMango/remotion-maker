/**
 * /api/audio/manifest — TM-130 / ADR-0026 §4 smoke test.
 * Validates the route returns the catalogue (sha256 stripped) and a
 * cache-control header so the Customize panel + edge can rely on stable
 * payload shape without a network round-trip per render.
 */
import { GET } from '@/app/api/audio/manifest/route';

describe('GET /api/audio/manifest', () => {
  it('returns version + tracks shaped for the customize picker', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; tracks: Array<Record<string, unknown>> };
    expect(body.version).toBe(1);
    expect(Array.isArray(body.tracks)).toBe(true);
    expect(body.tracks.length).toBeGreaterThan(0);
    for (const t of body.tracks) {
      expect(typeof t.filename).toBe('string');
      expect(typeof t.mood).toBe('string');
      expect(typeof t.bpm).toBe('number');
      expect(typeof t.durationSec).toBe('number');
      expect(typeof t.license).toBe('string');
      // sha256 is intentionally stripped from the public payload
      expect(t.sha256).toBeUndefined();
    }
  });

  it('emits a cache-control header (route is force-static + revalidated)', async () => {
    const res = await GET();
    const cc = res.headers.get('cache-control');
    expect(cc).toMatch(/s-maxage/);
  });
});
