/**
 * TM-103 — URL ingest unit tests.
 *
 * Covers: URL validation (SSRF guard), HTML parse (OG meta + headlines),
 * palette extraction, prompt formatter.
 */
import {
  validateIngestUrl,
  parseHtml,
  extractPalette,
  IngestError,
} from '@/lib/ingest/url';
import {
  formatIngestForPrompt,
  type IngestedContext,
} from '@/lib/ingest/format';

describe('validateIngestUrl', () => {
  it('accepts http and https', () => {
    expect(validateIngestUrl('https://example.com').protocol).toBe('https:');
    expect(validateIngestUrl('http://example.com').protocol).toBe('http:');
  });

  it('rejects non-http schemes', () => {
    expect(() => validateIngestUrl('ftp://example.com')).toThrow(IngestError);
    expect(() => validateIngestUrl('javascript:alert(1)')).toThrow(IngestError);
    expect(() => validateIngestUrl('file:///etc/passwd')).toThrow(IngestError);
  });

  it('rejects malformed URLs', () => {
    expect(() => validateIngestUrl('not a url')).toThrow(IngestError);
  });

  it('blocks loopback and private hosts (SSRF guard)', () => {
    for (const u of [
      'http://localhost/',
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/',
      'http://172.16.0.1/',
    ]) {
      expect(() => validateIngestUrl(u)).toThrow(IngestError);
    }
  });
});

describe('parseHtml', () => {
  const url = new URL('https://shop.example.com/products/widget');

  it('pulls OG meta + title fallback + h1/h2', () => {
    const html = `<html><head>
      <title>Plain Title</title>
      <meta property="og:title" content="Spring Widget 2026" />
      <meta property="og:description" content="Bouncy and bright." />
      <meta property="og:image" content="/img/hero.jpg" />
    </head><body>
      <h1>Welcome</h1>
      <h2>Featured</h2>
      <h2>Featured</h2>
      <h2> Bestsellers </h2>
    </body></html>`;
    const out = parseHtml(html, url);
    expect(out.title).toBe('Spring Widget 2026');
    expect(out.description).toBe('Bouncy and bright.');
    // Relative image URL must be resolved against the page URL.
    expect(out.image).toBe('https://shop.example.com/img/hero.jpg');
    // Headlines: deduped, trimmed, no empties.
    expect(out.headlines).toEqual(['Welcome', 'Featured', 'Bestsellers']);
  });

  it('falls back to <title> when og:title missing', () => {
    const html = `<html><head><title>Fallback</title></head><body></body></html>`;
    const out = parseHtml(html, url);
    expect(out.title).toBe('Fallback');
  });

  it('returns nulls when nothing parseable', () => {
    const out = parseHtml('<html></html>', url);
    expect(out.title).toBeNull();
    expect(out.description).toBeNull();
    expect(out.image).toBeNull();
    expect(out.headlines).toEqual([]);
  });

  it('caps headlines at MAX_HEADLINES (6)', () => {
    const hs = Array.from({ length: 12 }, (_, i) => `<h2>Section ${i}</h2>`).join('');
    const out = parseHtml(`<html><body>${hs}</body></html>`, url);
    expect(out.headlines).toHaveLength(6);
  });
});

describe('extractPalette', () => {
  it('counts hex colors and returns top frequencies', () => {
    const html = `<div style="color:#ff8800;background:#ff8800">a</div>
                  <div style="color:#3366cc">b</div>
                  <span style="color:#3366cc">c</span>
                  <span style="color:#aabbcc">d</span>`;
    const palette = extractPalette(html);
    // #ff8800 appears 2x, #3366cc appears 2x, #aabbcc 1x. Top should include all.
    expect(palette).toEqual(expect.arrayContaining(['#ff8800', '#3366cc', '#aabbcc']));
    expect(palette[0] === '#ff8800' || palette[0] === '#3366cc').toBe(true);
  });

  it('expands #abc shorthand to #aabbcc', () => {
    const palette = extractPalette('<style>.x{color:#abc}</style>');
    expect(palette).toContain('#aabbcc');
  });

  it('skips pure black and white (too generic)', () => {
    const palette = extractPalette('<x style="color:#000000;background:#ffffff">');
    expect(palette).not.toContain('#000000');
    expect(palette).not.toContain('#ffffff');
  });

  it('caps palette at 6 entries', () => {
    const html = Array.from({ length: 20 }, (_, i) =>
      `<x style="color:#${i.toString(16).padStart(6, '1')}">`,
    ).join('');
    expect(extractPalette(html).length).toBeLessThanOrEqual(6);
  });
});

describe('formatIngestForPrompt', () => {
  it('produces a stable ATTACHED CONTEXT block', () => {
    const ctx: IngestedContext = {
      url: 'https://shop.example.com/p/1',
      title: 'Spring Widget',
      description: 'Bouncy.',
      image: 'https://shop.example.com/hero.jpg',
      headlines: ['Welcome', 'Featured'],
      palette: ['#ff8800', '#3366cc'],
      fetchedAt: '2026-04-27T00:00:00.000Z',
    };
    const out = formatIngestForPrompt(ctx);
    expect(out).toMatch(/^\[ATTACHED CONTEXT — referenced URL\]/);
    expect(out).toContain('URL: https://shop.example.com/p/1');
    expect(out).toContain('Title: Spring Widget');
    expect(out).toContain('Description: Bouncy.');
    expect(out).toContain('Headlines: Welcome | Featured');
    expect(out).toContain('Palette hints: #ff8800, #3366cc');
    expect(out).toContain('Hero image: https://shop.example.com/hero.jpg');
  });

  it('omits sections that are missing', () => {
    const ctx: IngestedContext = {
      url: 'https://x.test',
      title: null,
      description: null,
      image: null,
      headlines: [],
      palette: [],
      fetchedAt: '2026-04-27T00:00:00.000Z',
    };
    const out = formatIngestForPrompt(ctx);
    expect(out).toContain('URL: https://x.test');
    expect(out).not.toMatch(/Title:/);
    expect(out).not.toMatch(/Palette/);
  });
});
