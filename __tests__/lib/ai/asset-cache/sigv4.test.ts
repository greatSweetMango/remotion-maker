/**
 * TM-89 — SigV4 signer determinism + correctness.
 *
 * We don't need to match AWS's reference vectors byte-for-byte (R2 accepts
 * standard SigV4); we assert the invariants that matter: deterministic for a
 * fixed clock, sensitive to body/method/secret, and well-formed headers.
 */
import { signS3Request } from '@/lib/ai/asset-cache/sigv4';

const BASE = {
  region: 'auto',
  service: 's3',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret123',
  now: new Date('2026-06-05T10:11:12.000Z'),
} as const;

describe('TM-89 signS3Request', () => {
  it('is deterministic for a fixed clock + inputs', () => {
    const a = signS3Request({ ...BASE, method: 'GET', url: 'https://acc.r2.cloudflarestorage.com/bucket/asset-gen/k.png', body: Buffer.alloc(0) });
    const b = signS3Request({ ...BASE, method: 'GET', url: 'https://acc.r2.cloudflarestorage.com/bucket/asset-gen/k.png', body: Buffer.alloc(0) });
    expect(a.headers.authorization).toBe(b.headers.authorization);
  });

  it('produces a well-formed Authorization header + amz headers', () => {
    const s = signS3Request({ ...BASE, method: 'GET', url: 'https://acc.r2.cloudflarestorage.com/bucket/asset-gen/k.png', body: Buffer.alloc(0) });
    expect(s.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260605\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[a-f0-9]{64}$/);
    expect(s.headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
    expect(s.headers['x-amz-date']).toBe('20260605T101112Z');
    expect(s.headers['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(s.headers.host).toBe('acc.r2.cloudflarestorage.com');
  });

  it('signature changes when the body changes (PUT payload binding)', () => {
    const a = signS3Request({ ...BASE, method: 'PUT', url: 'https://h/b/k.png', body: Buffer.from('one'), headers: { 'content-type': 'image/png' } });
    const b = signS3Request({ ...BASE, method: 'PUT', url: 'https://h/b/k.png', body: Buffer.from('two'), headers: { 'content-type': 'image/png' } });
    expect(a.headers.authorization).not.toBe(b.headers.authorization);
  });

  it('signature changes when the secret changes', () => {
    const a = signS3Request({ ...BASE, method: 'GET', url: 'https://h/b/k.png', body: Buffer.alloc(0) });
    const b = signS3Request({ ...BASE, secretAccessKey: 'different', method: 'GET', url: 'https://h/b/k.png', body: Buffer.alloc(0) });
    expect(a.headers.authorization).not.toBe(b.headers.authorization);
  });

  it('signature changes with the HTTP method', () => {
    const g = signS3Request({ ...BASE, method: 'GET', url: 'https://h/b/k.png', body: Buffer.alloc(0) });
    const p = signS3Request({ ...BASE, method: 'PUT', url: 'https://h/b/k.png', body: Buffer.alloc(0) });
    expect(g.headers.authorization).not.toBe(p.headers.authorization);
  });
});
