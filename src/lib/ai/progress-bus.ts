/**
 * TM-160 — In-memory progress event bus for SSE stage updates.
 *
 * Background: TM-91 introduced a client-side timer-driven progress bar
 * (`generationProgressPercent`) that approximates the multi-step pipeline
 * via a logistic curve. TM-156 added server-side stage marks
 * (`recordMark` in `latency-profile.ts`). TM-160 bridges the two: clients
 * subscribe to a per-request SSE stream and see real stage transitions
 * (outline → asset-gen → scene-code → compose → done) instead of a guess.
 *
 * Design rules:
 *   - Pure in-process pub/sub. One Node worker = one Map. Adequate for the
 *     single-instance dev/prod deployment (Vercel serverless: each request
 *     hits the same instance for its lifetime since EventSource + POST are
 *     short-lived and stick together via the progressId handshake).
 *   - Independent of `LATENCY_PROFILE` env — progress emission is always on
 *     when a `progressId` is registered for a request. Profiler logs stay
 *     gated separately.
 *   - Buffered: each channel keeps the last N events so a slightly-late
 *     subscriber (POST starts before EventSource attaches) still sees the
 *     full timeline. Buffer is bounded (32) to avoid leaks.
 *   - TTL'd: channels auto-evict after 5 minutes idle in case a generate
 *     fails to fire `complete` (network drop, hard crash mid-pipeline).
 *   - No external deps — Node `EventEmitter` is enough.
 *
 * NOT for: cross-instance fan-out (would need Redis pub/sub), persistence
 * (events are lost on restart — fine, generates are short-lived).
 */

import { EventEmitter } from 'node:events';

export interface ProgressEvent {
  /** Stable stage name. Matches `recordMark` phases for the most part. */
  stage: string;
  /** Wall-clock duration of the stage in ms. -1 means "started, still running". */
  ms: number;
  /** Optional structured context (cached, counts, etc). */
  meta?: Record<string, string | number | boolean | null | undefined>;
  /** Server timestamp (epoch ms) so the client can sort/dedupe. */
  at: number;
}

interface Channel {
  emitter: EventEmitter;
  buffer: ProgressEvent[];
  /** Map of latency req id → progressId. Updated as `recordMark` fires. */
  lastActivity: number;
  /** Set once the pipeline completes (success or error). Late subscribers replay then close. */
  completed: boolean;
}

const CHANNEL_TTL_MS = 5 * 60 * 1000;
const BUFFER_LIMIT = 64;

const channels = new Map<string, Channel>();
/** req id → progressId, populated when route handler links them. */
const reqToProgress = new Map<string, string>();

function gcExpired(now: number) {
  for (const [id, ch] of channels) {
    if (now - ch.lastActivity > CHANNEL_TTL_MS) {
      channels.delete(id);
      ch.emitter.removeAllListeners();
    }
  }
  // Also gc the reqToProgress map for entries pointing at gc'd channels.
  for (const [req, pid] of reqToProgress) {
    if (!channels.has(pid)) reqToProgress.delete(req);
  }
}

/** Open or reuse a channel for the given progressId. */
export function ensureChannel(progressId: string): void {
  gcExpired(Date.now());
  if (!channels.has(progressId)) {
    channels.set(progressId, {
      emitter: new EventEmitter(),
      buffer: [],
      lastActivity: Date.now(),
      completed: false,
    });
  }
}

/** Link a latency `req` id to a `progressId` so `recordMark` can forward. */
export function linkRequestToProgress(req: string, progressId: string): void {
  reqToProgress.set(req, progressId);
}

export function unlinkRequest(req: string): void {
  reqToProgress.delete(req);
}

export function progressIdForRequest(req: string): string | undefined {
  return reqToProgress.get(req);
}

export function publish(progressId: string, event: Omit<ProgressEvent, 'at'>): void {
  const ch = channels.get(progressId);
  if (!ch) return;
  const full: ProgressEvent = { ...event, at: Date.now() };
  ch.buffer.push(full);
  if (ch.buffer.length > BUFFER_LIMIT) ch.buffer.shift();
  ch.lastActivity = full.at;
  ch.emitter.emit('event', full);
}

/** Mark channel complete and emit a sentinel `done` event. Subscribers should close. */
export function complete(progressId: string, meta?: ProgressEvent['meta']): void {
  const ch = channels.get(progressId);
  if (!ch) return;
  publish(progressId, { stage: 'done', ms: 0, meta });
  ch.completed = true;
  // Keep channel briefly so late subscribers can replay + see done; gc handles cleanup.
  setTimeout(() => {
    channels.delete(progressId);
    ch.emitter.removeAllListeners();
  }, 5_000).unref?.();
}

export interface SubscribeHandle {
  /** Replay of events already in the buffer at subscribe time. */
  replay: ProgressEvent[];
  /** True if pipeline already finished — subscriber should close right after replay. */
  alreadyDone: boolean;
  /** Register a handler for future events. Returns an unsubscribe fn. */
  onEvent: (fn: (ev: ProgressEvent) => void) => () => void;
}

export function subscribe(progressId: string): SubscribeHandle {
  ensureChannel(progressId);
  const ch = channels.get(progressId)!;
  return {
    replay: ch.buffer.slice(),
    alreadyDone: ch.completed,
    onEvent(fn) {
      ch.emitter.on('event', fn);
      return () => ch.emitter.off('event', fn);
    },
  };
}

/** Test seam — clear all state. */
export function __resetForTests(): void {
  for (const ch of channels.values()) ch.emitter.removeAllListeners();
  channels.clear();
  reqToProgress.clear();
}

/** Test seam — inspect channel for tests. */
export function __debugChannel(progressId: string) {
  return channels.get(progressId);
}
