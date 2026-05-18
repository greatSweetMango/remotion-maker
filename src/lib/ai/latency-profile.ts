/**
 * TM-156 — Production latency profile.
 *
 * Thin structured logger used at strategic points in the generate stack
 * (route handler, generateAsset, asset-gen-stage, asset-gen, client) so
 * a single request emits a JSON-line trace we can grep / aggregate to
 * isolate the 29s production-vs-bench gap surfaced by TM-153.
 *
 * Design rules:
 *   - One log line per stage end. Never inside hot loops.
 *   - Single tag `[TM-156]` for trivial grep + a `phase` field.
 *   - `requestId` ties multiple stages of the same request together.
 *   - Numbers are wall-clock ms (`Date.now()` delta) — pricing precision
 *     not required; we want >100ms resolution on stage boundaries.
 *   - Gated on `LATENCY_PROFILE=1` so prod stays quiet unless we ask.
 *   - Zero behaviour change otherwise — pure observability.
 *
 * Schema (one line per `mark`):
 *   {"t":"TM-156","req":"abcd1234","phase":"asset-gen-wire","ms":7421,
 *    "meta":{"cached":false,"hash":"...","cost":0.04},"at":"2026-05-18T.."}
 *
 * Aggregation: see `scripts/qa/tm-156-latency-profile.mjs`.
 */

export interface LatencyMark {
  /** Short request id (8 hex chars) shared across all marks for one /api/generate call. */
  req: string;
  /** Stage name. Snake-case, stable across runs so aggregation works. */
  phase: string;
  /** Wall-clock duration in ms. */
  ms: number;
  /** Free-form, JSON-serialisable per-stage context (cached flag, sizes, etc). */
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export function newRequestId(): string {
  // 4 random bytes → 8 hex chars. crypto.randomUUID would also work but
  // shorter ids make `grep` output more readable.
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

/** Disabled by default — flip `LATENCY_PROFILE=1` to enable. */
export function isLatencyProfileEnabled(): boolean {
  return process.env.LATENCY_PROFILE === '1';
}

export function recordMark(mark: LatencyMark): void {
  if (!isLatencyProfileEnabled()) return;
  try {
    const line = JSON.stringify({
      t: 'TM-156',
      req: mark.req,
      phase: mark.phase,
      ms: mark.ms,
      ...(mark.meta ? { meta: mark.meta } : {}),
      at: new Date().toISOString(),
    });
    // eslint-disable-next-line no-console
    console.warn(`[TM-156] ${line}`);
  } catch {
    // never let the profiler break the request
  }
}

/**
 * Convenience wrapper: time an async fn and emit a mark. Returns the
 * underlying value untouched. When profiling is disabled the wrapper is
 * still cheap (one `Date.now()` pair) so callers don't need to branch.
 */
export async function timed<T>(
  req: string,
  phase: string,
  fn: () => Promise<T>,
  metaFn?: (value: T) => LatencyMark['meta'],
): Promise<T> {
  const start = Date.now();
  try {
    const value = await fn();
    recordMark({
      req,
      phase,
      ms: Date.now() - start,
      meta: metaFn ? metaFn(value) : undefined,
    });
    return value;
  } catch (err) {
    recordMark({
      req,
      phase: `${phase}.error`,
      ms: Date.now() - start,
      meta: { error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) },
    });
    throw err;
  }
}
