/**
 * TM-89 — runAssetGenStage × cache integration.
 *
 * Verifies the ADR-0022 behaviour contract:
 *   - MISS  → image-gen called once, asset persisted, spend = costUsd.
 *   - HIT   → image-gen NOT called, spend recorded as 0.
 * Uses an injected in-memory cache + spend spy so it is fully deterministic
 * and backend-agnostic (no FS, no R2, no OpenAI).
 */
import {
  runAssetGenStage,
  __resetAssetGenCache,
  recordAssetGenSpend,
} from '@/lib/ai/asset-gen-stage';
import type { AssetCache, CachedAsset, PutAssetInput } from '@/lib/ai/asset-cache';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=', 'base64');

function makeStubGen() {
  return jest.fn(async ({ prompt }: { prompt: string }) => ({
    pngBytes: PNG,
    dataUrl: 'data:image/png;base64,xxx',
    costUsd: 0.04,
    latencyMs: 100,
    prompt,
    size: '1024x1024',
    quality: 'low',
  }));
}

/** Minimal in-memory cache implementing the AssetCache contract. */
function makeMemCache(): AssetCache & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    name: 'mem',
    store,
    async get(cacheKey: string): Promise<CachedAsset | null> {
      const b = store.get(cacheKey);
      return b ? { url: `mem://${cacheKey}`, bytes: b, provider: 'mem' } : null;
    },
    async put(input: PutAssetInput): Promise<string> {
      store.set(input.cacheKey, input.bytes);
      return `mem://${input.cacheKey}`;
    },
  };
}

describe('TM-89 stage × cache', () => {
  beforeEach(() => __resetAssetGenCache());

  it('MISS: generates once, persists, records full cost', async () => {
    const gen = makeStubGen();
    const cache = makeMemCache();
    const recordSpend = jest.fn();

    const out = await runAssetGenStage({
      prompt: '곰돌이 캐릭터 10초',
      imageGenerator: gen as never,
      cache,
      recordSpend,
    });

    expect(out).not.toBeNull();
    expect(out!.cached).toBe(false);
    expect(out!.cacheProvider).toBe('mem');
    expect(out!.imageUrl).toMatch(/^mem:\/\//);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);
    expect(recordSpend).toHaveBeenCalledWith(0.04);
  });

  it('HIT: skips image-gen, records cost 0 (ADR-0022)', async () => {
    const cache = makeMemCache();
    const recordSpend = jest.fn();

    // Pre-warm the cache from a first miss.
    const gen1 = makeStubGen();
    await runAssetGenStage({ prompt: 'astronaut floating', imageGenerator: gen1 as never, cache, recordSpend });
    expect(gen1).toHaveBeenCalledTimes(1);

    // Simulate a fresh process — clear ONLY the in-memory short-circuit.
    __resetAssetGenCache();
    recordSpend.mockClear();

    const gen2 = makeStubGen();
    const out = await runAssetGenStage({ prompt: 'astronaut floating', imageGenerator: gen2 as never, cache, recordSpend });

    expect(gen2).not.toHaveBeenCalled(); // image-gen skipped
    expect(out!.cached).toBe(true);
    expect(out!.costUsd).toBe(0);
    expect(recordSpend).toHaveBeenCalledWith(0); // cost-0 record
  });

  it('same-process repeat hits in-memory short-circuit (still cost 0)', async () => {
    const gen = makeStubGen();
    const cache = makeMemCache();
    const recordSpend = jest.fn();
    const a = await runAssetGenStage({ prompt: 'dragon flying', imageGenerator: gen as never, cache, recordSpend });
    const b = await runAssetGenStage({ prompt: 'dragon flying', imageGenerator: gen as never, cache, recordSpend });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(b!.cached).toBe(true);
    expect(b!.costUsd).toBe(0);
    expect(a!.imageUrl).toBe(b!.imageUrl);
  });

  it('recordAssetGenSpend is a no-op for zero/negative cost', () => {
    // Should not throw and should early-return without touching the ledger.
    expect(() => recordAssetGenSpend(0)).not.toThrow();
    expect(() => recordAssetGenSpend(-1)).not.toThrow();
  });
});
