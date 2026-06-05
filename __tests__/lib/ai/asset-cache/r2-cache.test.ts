/**
 * TM-89 — R2 cache adapter against a deterministic MOCK fetch.
 *
 * No live R2 connection (escalated — needs credentials). We assert the
 * adapter signs + routes GET/PUT correctly, maps 404 → miss, surfaces public
 * URLs, and never throws on a network error during get.
 */
import { createR2AssetCache, r2Configured, r2ConfigFromEnv, type FetchLike, type R2Config } from '@/lib/ai/asset-cache';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=', 'base64');

function cfg(over: Partial<R2Config> = {}): R2Config {
  return {
    bucket: 'easymake-assets',
    accountId: 'acct123',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    keyPrefix: 'asset-gen',
    region: 'auto',
    ...over,
  };
}

describe('TM-89 r2Configured / r2ConfigFromEnv', () => {
  const REQ = {
    R2_BUCKET_NAME: 'b',
    R2_ACCOUNT_ID: 'a',
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
  };
  it('false when any var missing', () => {
    expect(r2Configured({})).toBe(false);
    expect(r2Configured({ ...REQ, R2_SECRET_ACCESS_KEY: undefined } as never)).toBe(false);
  });
  it('false on placeholder values', () => {
    expect(r2Configured({ ...REQ, R2_ACCESS_KEY_ID: 'placeholder' } as never)).toBe(false);
  });
  it('true + builds config when all present', () => {
    expect(r2Configured(REQ as never)).toBe(true);
    const c = r2ConfigFromEnv({ ...REQ, R2_KEY_PREFIX: 'custom' } as never);
    expect(c.bucket).toBe('b');
    expect(c.keyPrefix).toBe('custom');
    expect(c.region).toBe('auto');
  });
});

describe('TM-89 r2 cache GET', () => {
  it('returns bytes + public url on a 200', async () => {
    const fetchFn: FetchLike = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    }));
    const cache = createR2AssetCache(cfg({ publicBaseUrl: 'https://cdn.easymake.app', fetchFn }));
    const hit = await cache.get('hash123');
    expect(hit).not.toBeNull();
    expect(hit!.provider).toBe('r2');
    expect(hit!.url).toBe('https://cdn.easymake.app/asset-gen/hash123.png');
    expect(Buffer.compare(hit!.bytes, PNG)).toBe(0);

    // Signed GET hit the S3 endpoint with an Authorization header.
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(url).toBe('https://acct123.r2.cloudflarestorage.com/easymake-assets/asset-gen/hash123.png');
    expect(init.method).toBe('GET');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('maps 404 to a miss (null)', async () => {
    const fetchFn: FetchLike = jest.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    const cache = createR2AssetCache(cfg({ fetchFn }));
    expect(await cache.get('missing')).toBeNull();
  });

  it('never throws on a network error (degrades to miss)', async () => {
    const fetchFn: FetchLike = jest.fn(async () => { throw new Error('ECONNRESET'); });
    const cache = createR2AssetCache(cfg({ fetchFn }));
    expect(await cache.get('boom')).toBeNull();
  });

  it('falls back to endpoint url when no public base configured', async () => {
    const fetchFn: FetchLike = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => PNG.buffer }));
    const cache = createR2AssetCache(cfg({ fetchFn }));
    const hit = await cache.get('h');
    expect(hit!.url).toBe('https://acct123.r2.cloudflarestorage.com/easymake-assets/asset-gen/h.png');
  });
});

describe('TM-89 r2 cache PUT', () => {
  it('signs a PUT with body + content-type and returns the public url', async () => {
    const fetchFn: FetchLike = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
    const cache = createR2AssetCache(cfg({ publicBaseUrl: 'https://cdn.x/', fetchFn }));
    const url = await cache.put({ cacheKey: 'newhash', bytes: PNG });
    expect(url).toBe('https://cdn.x/asset-gen/newhash.png');

    const [putUrl, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(putUrl).toBe('https://acct123.r2.cloudflarestorage.com/easymake-assets/asset-gen/newhash.png');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(PNG);
    expect(init.headers['content-type']).toBe('image/png');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('throws on a non-ok PUT (caller logs but still serves bytes)', async () => {
    const fetchFn: FetchLike = jest.fn(async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) }));
    const cache = createR2AssetCache(cfg({ fetchFn }));
    await expect(cache.put({ cacheKey: 'x', bytes: PNG })).rejects.toThrow(/status 403/);
  });
});
