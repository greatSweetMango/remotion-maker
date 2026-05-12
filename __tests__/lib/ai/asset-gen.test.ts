/**
 * TM-84 — unit tests for asset-gen wrapper.
 *
 * No live OpenAI calls. Stubs the `images.generate` method via the
 * `client` injection seam.
 */
import { generateAssetImage, GPT_IMAGE_1_PRICE_USD_1024 } from '../../../src/lib/ai/asset-gen';

function makeStubClient(b64: string | null) {
  return {
    images: {
      generate: jest.fn(async () => ({
        data: b64 === null ? [{}] : [{ b64_json: b64 }],
      })),
    },
  } as unknown as Parameters<typeof generateAssetImage>[0]['client'];
}

const TINY_PNG_B64 =
  // 1x1 transparent PNG — 67 bytes decoded, enough for buffer assertions.
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

describe('TM-84 generateAssetImage', () => {
  it('returns pngBytes + data URL + cost + latency for a valid response', async () => {
    const client = makeStubClient(TINY_PNG_B64);
    const result = await generateAssetImage({ prompt: 'a friendly cartoon bear', client });

    expect(result.pngBytes).toBeInstanceOf(Buffer);
    expect(result.pngBytes.length).toBeGreaterThan(0);
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.costUsd).toBe(GPT_IMAGE_1_PRICE_USD_1024);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.prompt).toBe('a friendly cartoon bear');
    expect(result.size).toBe('1024x1024');
  });

  it('passes prompt + model + size to the OpenAI client', async () => {
    const client = makeStubClient(TINY_PNG_B64);
    await generateAssetImage({
      prompt: 'a corgi on a beach',
      size: '1024x1536',
      quality: 'medium',
      client,
    });

    const calls = (client as unknown as { images: { generate: jest.Mock } }).images.generate.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      model: 'gpt-image-1',
      prompt: 'a corgi on a beach',
      size: '1024x1536',
      n: 1,
    });
  });

  it('throws on empty prompt without calling OpenAI', async () => {
    const client = makeStubClient(TINY_PNG_B64);
    await expect(generateAssetImage({ prompt: '   ', client })).rejects.toThrow(/non-empty/);
    expect(
      (client as unknown as { images: { generate: jest.Mock } }).images.generate,
    ).not.toHaveBeenCalled();
  });

  it('throws when the OpenAI response omits b64_json', async () => {
    const client = makeStubClient(null);
    await expect(generateAssetImage({ prompt: 'whatever', client })).rejects.toThrow(/b64_json/);
  });
});
