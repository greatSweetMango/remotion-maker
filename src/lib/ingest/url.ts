/**
 * TM-103 — URL ingest
 *
 * Fetch a public web page (e.g. a product / shopping mall URL) and extract a
 * compact "context" object that we can inject into the generation prompt:
 *  - OG / Twitter meta (title, description, image)
 *  - h1 / h2 headlines
 *  - inline CSS color tokens (rough palette, top-frequency)
 *
 * Notes:
 *  - SSRF guarded — only http/https; reject loopback / private IPs
 *  - 6 s timeout; 1.5 MB cap on body to keep latency + memory bounded
 *  - cheerio for parsing (no JS execution — we don't need SPAs for v1)
 *  - Caller decides what to inject — this lib only extracts.
 *
 * See ADR-PENDING-TM-103.
 */
import * as cheerio from 'cheerio';
export { formatIngestForPrompt, type IngestedContext } from './format';
import type { IngestedContext } from './format';

export class IngestError extends Error {
  constructor(message: string, public readonly code: 'BAD_URL' | 'BLOCKED' | 'FETCH_FAILED' | 'TOO_LARGE' | 'TIMEOUT') {
    super(message);
    this.name = 'IngestError';
  }
}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 6_000;
const MAX_HEADLINES = 6;
const MAX_PALETTE = 6;

const PRIVATE_HOST_RE = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|::1|fc00:|fe80:|172\.(1[6-9]|2\d|3[0-1])\.)/i;

export function validateIngestUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new IngestError('Invalid URL', 'BAD_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new IngestError('Only http(s) URLs are supported', 'BAD_URL');
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new IngestError('Private/loopback hosts are blocked', 'BLOCKED');
  }
  return parsed;
}

/**
 * Pull HTML for the URL with size + time bounds.
 * Throws `IngestError` on failures.
 */
export async function fetchHtml(url: URL, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Caller-provided signal also aborts.
  signal?.addEventListener('abort', () => controller.abort());

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Identify ourselves but mimic a normal browser to avoid trivial blocks.
        'user-agent':
          'Mozilla/5.0 (compatible; EasyMakeBot/1.0; +https://easymake.app/bot)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new IngestError(`Fetch timed out after ${TIMEOUT_MS}ms`, 'TIMEOUT');
    }
    throw new IngestError(`Fetch failed: ${(err as Error).message}`, 'FETCH_FAILED');
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new IngestError(`HTTP ${res.status}`, 'FETCH_FAILED');
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('html') && !ct.includes('xml') && ct.length > 0) {
    throw new IngestError(`Unsupported content-type: ${ct}`, 'FETCH_FAILED');
  }

  // Cap the body size — read the underlying stream so a 50MB page doesn't OOM.
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new IngestError('Response too large', 'TOO_LARGE');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) throw new IngestError('Response too large', 'TOO_LARGE');
      chunks.push(value);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

function pickMeta($: cheerio.CheerioAPI, ...names: string[]): string | null {
  for (const name of names) {
    const v = $(`meta[property="${name}"], meta[name="${name}"]`).attr('content');
    if (v && v.trim()) return v.trim();
  }
  return null;
}

const HEX_RE = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;

export function extractPalette(html: string): string[] {
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(html))) {
    let hex = m[0].toLowerCase();
    if (hex.length === 4) {
      // expand #abc → #aabbcc for stable comparison
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    // Reject pure black/white — they dominate every page and aren't useful for vibe.
    if (hex === '#000000' || hex === '#ffffff') continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PALETTE)
    .map(([hex]) => hex);
}

export function parseHtml(html: string, url: URL): Omit<IngestedContext, 'fetchedAt'> {
  const $ = cheerio.load(html);
  const title =
    pickMeta($, 'og:title', 'twitter:title') ??
    ($('title').first().text().trim() || null);
  const description = pickMeta(
    $,
    'og:description',
    'twitter:description',
    'description',
  );
  let image = pickMeta($, 'og:image', 'twitter:image');
  if (image && !/^https?:\/\//i.test(image)) {
    try {
      image = new URL(image, url).toString();
    } catch {
      image = null;
    }
  }
  const headlines: string[] = [];
  $('h1, h2').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length <= 200 && !headlines.includes(t)) {
      headlines.push(t);
    }
  });
  const palette = extractPalette(html);
  return {
    url: url.toString(),
    title: title || null,
    description: description || null,
    image: image || null,
    headlines: headlines.slice(0, MAX_HEADLINES),
    palette,
  };
}

export async function ingestUrl(input: string, signal?: AbortSignal): Promise<IngestedContext> {
  const url = validateIngestUrl(input);
  const html = await fetchHtml(url, signal);
  const parsed = parseHtml(html, url);
  return { ...parsed, fetchedAt: new Date().toISOString() };
}

