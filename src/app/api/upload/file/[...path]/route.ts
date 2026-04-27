/**
 * GET /api/upload/file/<userId>/<kind>/<id>.<ext>
 *
 * Serves files written by the `local` storage provider. Only used in dev /
 * CI / when no production storage backend is configured. In production with
 * Vercel Blob the URL points directly at the blob CDN and this route is not
 * exercised.
 *
 * Auth note: this is a read-only endpoint; URLs are unguessable
 * (12-byte random ids) and are intended to behave like signed URLs. We do
 * NOT require a session here so generated Remotion code (which embeds the
 * URL as a string) keeps working when rendered server-side or shared.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function uploadRoot(): string {
  return process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), '.uploads');
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await ctx.params;
  const rel = parts.join('/');
  // Defense in depth — the provider only writes flat `userId/kind/id.ext`
  // shapes; reject anything else.
  if (rel.includes('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }
  const filePath = path.join(uploadRoot(), rel);
  let body: Buffer;
  try {
    body = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ext = path.extname(rel).replace('.', '').toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';

  // Buffer is structurally compatible with BodyInit at runtime (Uint8Array),
  // but TS Response types are stricter. Cast to BodyInit.
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': mime,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
