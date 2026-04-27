import type { NextConfig } from 'next';

/**
 * Content Security Policy — defense-in-depth around the LLM sandbox.
 *
 * The evaluator unavoidably uses `new Function(...)`, which requires
 * `'unsafe-eval'` in `script-src`. The CSP narrows everything else:
 *   - `connect-src 'self'` + Remotion CDN — blocks data exfil to attacker host
 *     even if a sandbox bypass leaks `fetch` to the page.
 *   - `frame-ancestors 'none'` — defense against clickjacking the studio.
 *   - `object-src 'none'` — blocks legacy plugin vectors.
 *
 * See ADR-PENDING-TM-34 for the full hardening rationale.
 */
const SANDBOX_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // `data:` is required for Remotion's audio probe, which decodes silent
  // base64 WAV stubs into <audio> elements during preview. Without it the
  // browser logs "Refused to load media: data:audio/..." (TM-50).
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://*.remotion.dev https://*.googleapis.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler', 'sucrase'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  env: {
    DEV_AUTO_LOGIN: process.env.DEV_AUTO_LOGIN ?? '',
  },
  async headers() {
    return [
      {
        // Apply CSP to every HTML route. Static assets (_next/*, images) are
        // exempted by Next 16's default header routing for non-page requests.
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: SANDBOX_CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
