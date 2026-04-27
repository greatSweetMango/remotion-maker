/**
 * TM-50: ensure the CSP `media-src` directive permits `data:` URIs so that
 * Remotion's audio probe (base64 WAV stub) doesn't trip the browser's CSP
 * enforcement on the customize page.
 */
import nextConfig from '../../next.config';

async function getCsp(): Promise<string> {
  const config = nextConfig as unknown as {
    headers?: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>>;
  };
  if (!config.headers) throw new Error('headers() not defined on next.config');
  const groups = await config.headers();
  for (const group of groups) {
    for (const h of group.headers) {
      if (h.key === 'Content-Security-Policy') return h.value;
    }
  }
  throw new Error('Content-Security-Policy header missing');
}

describe('next.config CSP', () => {
  it('media-src allows data: (Remotion audio probe)', async () => {
    const csp = await getCsp();
    const match = csp.split(';').map(d => d.trim()).find(d => d.startsWith('media-src'));
    expect(match).toBeDefined();
    expect(match).toMatch(/(^|\s)data:(\s|$)/);
  });

  it('media-src still allows self / blob / https', async () => {
    const csp = await getCsp();
    const match = csp.split(';').map(d => d.trim()).find(d => d.startsWith('media-src'))!;
    expect(match).toMatch(/'self'/);
    expect(match).toMatch(/(^|\s)blob:(\s|$)/);
    expect(match).toMatch(/(^|\s)https:(\s|$)/);
  });

  it('preserves frame-ancestors none and object-src none', async () => {
    const csp = await getCsp();
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });
});
