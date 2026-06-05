/**
 * TM-89 — minimal AWS Signature V4 signer for S3-compatible endpoints
 * (Cloudflare R2). Implemented with Node's built-in `crypto` so the R2
 * adapter needs **no new npm dependency** (no `@aws-sdk/client-s3`).
 *
 * Scope: only the GET / PUT object operations the asset cache needs, with a
 * pre-hashed payload (we always know the body up front), region `auto`
 * (R2 convention), and SHA256 unsigned-payload not required. This is NOT a
 * general-purpose AWS signer — keep it that way; widen only with a test.
 *
 * Reference: AWS SigV4 "Signature Version 4 signing process".
 */
import { createHash, createHmac } from 'node:crypto';

export interface SignParams {
  method: 'GET' | 'PUT';
  /** Full URL including host + path (already URL-encoded). */
  url: string;
  region: string;
  service: string; // 's3' for R2
  accessKeyId: string;
  secretAccessKey: string;
  /** Raw request body bytes (empty Buffer for GET). */
  body: Buffer;
  /** Extra headers to sign (e.g. content-type). Lowercased keys. */
  headers?: Record<string, string>;
  /** Override clock for deterministic tests. */
  now?: Date;
}

export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** ISO8601 basic format: YYYYMMDDTHHMMSSZ */
function amzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  // iso is now like 20260605T101112Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Sign an S3-compatible request. Returns headers (including Authorization)
 * to pass to fetch. URL is unchanged (signed via headers, not query string).
 */
export function signS3Request(p: SignParams): SignedRequest {
  const { amzDate: amzDateStr, dateStamp } = amzDate(p.now ?? new Date());
  const u = new URL(p.url);
  const host = u.host;
  const payloadHash = sha256Hex(p.body);

  // Canonical headers — must be sorted by lowercase name.
  const baseHeaders: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDateStr,
    ...(p.headers ?? {}),
  };
  const sortedKeys = Object.keys(baseHeaders)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders =
    sortedKeys.map((k) => `${k}:${String(baseHeaders[k]).trim()}`).join('\n') + '\n';
  const signedHeaders = sortedKeys.join(';');

  // Canonical query string (sorted). For our use there are usually none.
  const canonicalQuery = [...u.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    p.method,
    u.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${p.region}/${p.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDateStr,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${p.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, p.region);
  const kService = hmac(kRegion, p.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: p.url,
    method: p.method,
    headers: {
      ...baseHeaders,
      authorization,
    },
  };
}
