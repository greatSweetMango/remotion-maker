import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ingestUrl, IngestError } from '@/lib/ingest/url';

export const runtime = 'nodejs';
// Force dynamic — we explicitly do NOT want Next caching arbitrary external URLs.
export const dynamic = 'force-dynamic';

/**
 * POST /api/ingest/url — TM-103
 *
 * Body: { url: string }
 * Resp: IngestedContext (see src/lib/ingest/url.ts)
 *
 * Auth required. The caller is expected to attach the returned context to
 * a subsequent /api/generate prompt. This route does NOT consume generation
 * quota; it's a separate, lightweight scrape (rate limit budget is only
 * the timeout + body cap inside the lib).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || url.length === 0) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }
  if (url.length > 2048) {
    return NextResponse.json({ error: 'url too long' }, { status: 400 });
  }

  try {
    const ctx = await ingestUrl(url);
    return NextResponse.json(ctx);
  } catch (err) {
    if (err instanceof IngestError) {
      const status =
        err.code === 'BAD_URL' || err.code === 'BLOCKED'
          ? 400
          : err.code === 'TIMEOUT'
            ? 504
            : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[ingest/url] unexpected', err);
    const msg = err instanceof Error ? err.message : 'Ingest failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
