/**
 * TM-160 — SSE endpoint that streams real pipeline stage events for an
 * in-flight /api/generate request.
 *
 * Contract:
 *   GET /api/generate/progress?id=<progressId>
 *     - `id` MUST match the `progressId` the client passed in the
 *       companion POST body. Format: 6–64 chars [a-zA-Z0-9_-].
 *     - Response is `text/event-stream` with messages:
 *         event: stage
 *         data: {"stage":"pipeline.outline","ms":6231,"at":1700000000000,"meta":{...}}
 *       and a sentinel:
 *         event: done
 *         data: {"type":"generate","totalMs":57231}
 *     - Connection stays open until `done` is published OR the channel
 *       TTL expires (5 min). Either side may close at any time.
 *
 * Auth: best-effort. We require an authenticated session to prevent
 * channel-id guessing leaking stage timing of other users, but the
 * progressId itself is unguessable random (client generates 16 hex
 * chars). No quota / DB writes here.
 *
 * Browser fallback: if the runtime doesn't support EventSource, the
 * client keeps the TM-91 timer-based copy untouched.
 */

import { auth } from '@/lib/auth';
import { subscribe, ensureChannel, type ProgressEvent } from '@/lib/ai/progress-bus';

export const runtime = 'nodejs';
// SSE needs a real Node stream — opt out of any caching layer Next 16
// might apply by default. (Next 16 dynamic-by-default is fine here but
// be explicit.)
export const dynamic = 'force-dynamic';

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) {
    return new Response('Bad progressId', { status: 400 });
  }

  // Ensure channel exists so a slightly-early subscriber (EventSource
  // resolves before the POST hits the route handler) still gets buffered
  // events when they arrive.
  ensureChannel(id);
  const handle = subscribe(id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Initial comment so the client's `onopen` fires immediately even
      // before any stage events. Helps with the "connection just hangs"
      // perception on slow first-token.
      safeEnqueue(`: tm-160 progress stream open id=${id}\n\n`);

      // Replay buffered events so a late subscriber catches up.
      for (const ev of handle.replay) {
        safeEnqueue(sseFrame(ev.stage === 'done' ? 'done' : 'stage', ev));
      }

      if (handle.alreadyDone) {
        // Nothing more to wait for.
        try { controller.close(); } catch { /* already closed */ }
        closed = true;
        return;
      }

      // Heartbeat every 15s so intermediaries (Vercel, nginx) don't kill
      // an idle connection during a long asset-gen wait. Comment lines
      // are ignored by EventSource.
      const heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${Date.now()}\n\n`);
      }, 15_000);
      heartbeat.unref?.();

      const unsubscribe = handle.onEvent((ev: ProgressEvent) => {
        safeEnqueue(sseFrame(ev.stage === 'done' ? 'done' : 'stage', ev));
        if (ev.stage === 'done') {
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      });

      // Hard cap: even if the upstream pipeline silently dies, the
      // connection self-closes after 5 minutes (matches the bus TTL).
      const maxLifetime = setTimeout(() => {
        safeEnqueue(sseFrame('done', { stage: 'done', ms: 0, meta: { reason: 'timeout' }, at: Date.now() }));
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
        closed = true;
      }, 5 * 60 * 1000);
      maxLifetime.unref?.();

      // Abort propagation: when the client closes the EventSource (page
      // navigated away, tab closed) the request's AbortSignal fires.
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        clearTimeout(maxLifetime);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
        closed = true;
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
