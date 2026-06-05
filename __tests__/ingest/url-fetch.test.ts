/**
 * TM-189 — coverage hot-spot: `fetchHtml` + `ingestUrl` network paths.
 *
 * The pure parsing helpers are covered by `url.test.ts`; this file pins the
 * fetch-bound branches (content-type guard, !ok, size cap, timeout/abort,
 * streamed vs. buffered body) with a mocked global `fetch`, so it stays
 * offline and deterministic.
 */
import { fetchHtml, ingestUrl, IngestError } from '@/lib/ingest/url';

const realFetch = global.fetch;

/** Build a Response whose body streams a single UTF-8 chunk. */
function streamingResponse(
  html: string,
  init?: { ok?: boolean; status?: number; contentType?: string | null },
): Response {
  const bytes = new TextEncoder().encode(html);
  const headers = new Headers();
  if (init?.contentType !== null) {
    headers.set('content-type', init?.contentType ?? 'text/html; charset=utf-8');
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers,
    body,
    text: async () => html,
  } as unknown as Response;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

describe('TM-189 fetchHtml', () => {
  const url = new URL('https://example.com');

  it('returns the decoded body for an OK html response', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamingResponse('<html><body>hi</body></html>'),
    ) as unknown as typeof fetch;
    const html = await fetchHtml(url);
    expect(html).toContain('hi');
  });

  it('sends a browser-like user-agent and follows redirects', async () => {
    const spy = jest.fn().mockResolvedValue(streamingResponse('<html></html>'));
    global.fetch = spy as unknown as typeof fetch;
    await fetchHtml(url);
    const [, opts] = spy.mock.calls[0];
    expect(opts.redirect).toBe('follow');
    expect(opts.headers['user-agent']).toMatch(/EasyMakeBot/);
  });

  it('throws FETCH_FAILED on a non-OK status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(streamingResponse('nope', { ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(fetchHtml(url)).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('rejects an unsupported (non-html/xml) content-type', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamingResponse('{}', { contentType: 'application/json' }),
    ) as unknown as typeof fetch;
    await expect(fetchHtml(url)).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('allows an empty content-type (length 0) through', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      streamingResponse('<html>ok</html>', { contentType: null }),
    ) as unknown as typeof fetch;
    await expect(fetchHtml(url)).resolves.toContain('ok');
  });

  it('maps a fetch AbortError to a TIMEOUT IngestError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortErr) as unknown as typeof fetch;
    await expect(fetchHtml(url)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('maps a generic network error to FETCH_FAILED', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(fetchHtml(url)).rejects.toBeInstanceOf(IngestError);
  });

  it('enforces the body size cap while streaming', async () => {
    // ~2MB chunk exceeds the 1.5MB cap.
    const huge = 'a'.repeat(2_000_000);
    global.fetch = jest.fn().mockResolvedValue(
      streamingResponse(huge),
    ) as unknown as typeof fetch;
    await expect(fetchHtml(url)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('falls back to .text() when the response has no readable body', async () => {
    const headers = new Headers({ 'content-type': 'text/html' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      body: null,
      text: async () => '<html>buffered</html>',
    } as unknown as Response) as unknown as typeof fetch;
    await expect(fetchHtml(url)).resolves.toContain('buffered');
  });
});

describe('TM-189 ingestUrl (validate → fetch → parse)', () => {
  it('validates, fetches and parses into an IngestedContext', async () => {
    const html =
      '<html><head><meta property="og:title" content="Hello"><meta property="og:description" content="World"></head><body><h1>Headline</h1></body></html>';
    global.fetch = jest.fn().mockResolvedValue(streamingResponse(html)) as unknown as typeof fetch;
    const ctx = await ingestUrl('https://example.com');
    expect(ctx.title).toBe('Hello');
    expect(ctx.description).toBe('World');
    expect(typeof ctx.fetchedAt).toBe('string');
    expect(() => new Date(ctx.fetchedAt)).not.toThrow();
  });

  it('rejects a blocked/private host before any fetch', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    await expect(ingestUrl('http://127.0.0.1/admin')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
