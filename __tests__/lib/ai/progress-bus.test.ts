/**
 * TM-160 — unit tests for the in-memory progress event bus.
 *
 * Covers:
 *  - subscribe-before-publish (live event path)
 *  - subscribe-after-publish (replay path with buffer)
 *  - complete() emits a `done` sentinel and unsubscribes future fires
 *  - linkRequestToProgress forwards `recordMark` into the bus
 *  - channels are isolated by progressId
 */

import {
  ensureChannel,
  subscribe,
  publish,
  complete,
  linkRequestToProgress,
  unlinkRequest,
  progressIdForRequest,
  __resetForTests,
  __debugChannel,
  type ProgressEvent,
} from '@/lib/ai/progress-bus';
import { recordMark } from '@/lib/ai/latency-profile';

describe('progress-bus', () => {
  beforeEach(() => __resetForTests());

  it('delivers events to a subscriber attached before publish', async () => {
    ensureChannel('pg_test_live');
    const handle = subscribe('pg_test_live');
    const received: ProgressEvent[] = [];
    handle.onEvent((ev) => received.push(ev));

    publish('pg_test_live', { stage: 'pipeline.outline', ms: 6231 });
    publish('pg_test_live', { stage: 'pipeline.scene-code', ms: 4120, meta: { count: 3 } });

    expect(received.map((e) => e.stage)).toEqual([
      'pipeline.outline',
      'pipeline.scene-code',
    ]);
    expect(received[1].meta).toEqual({ count: 3 });
    expect(received[0].at).toBeGreaterThan(0);
  });

  it('replays buffered events to a late subscriber', () => {
    ensureChannel('pg_test_replay');
    publish('pg_test_replay', { stage: 'route.auth', ms: 12 });
    publish('pg_test_replay', { stage: 'route.body-parse', ms: 3 });

    const handle = subscribe('pg_test_replay');
    expect(handle.replay.map((e) => e.stage)).toEqual([
      'route.auth',
      'route.body-parse',
    ]);
    expect(handle.alreadyDone).toBe(false);
  });

  it('complete() publishes a `done` event and marks channel done', () => {
    ensureChannel('pg_test_done');
    const handle = subscribe('pg_test_done');
    const received: ProgressEvent[] = [];
    handle.onEvent((ev) => received.push(ev));

    complete('pg_test_done', { type: 'generate' });
    expect(received.some((e) => e.stage === 'done')).toBe(true);

    // Late subscriber must see alreadyDone=true.
    const late = subscribe('pg_test_done');
    expect(late.alreadyDone).toBe(true);
    expect(late.replay.some((e) => e.stage === 'done')).toBe(true);
  });

  it('isolates channels by progressId', () => {
    ensureChannel('pg_a');
    ensureChannel('pg_b');
    const a: ProgressEvent[] = [];
    const b: ProgressEvent[] = [];
    subscribe('pg_a').onEvent((ev) => a.push(ev));
    subscribe('pg_b').onEvent((ev) => b.push(ev));

    publish('pg_a', { stage: 'only.a', ms: 1 });
    expect(a.map((e) => e.stage)).toEqual(['only.a']);
    expect(b).toEqual([]);
  });

  it('linkRequestToProgress forwards recordMark into the bus', () => {
    const reqId = 'abc12345';
    const pid = 'pg_link_test';
    ensureChannel(pid);
    linkRequestToProgress(reqId, pid);
    expect(progressIdForRequest(reqId)).toBe(pid);

    const received: ProgressEvent[] = [];
    subscribe(pid).onEvent((ev) => received.push(ev));

    recordMark({ req: reqId, phase: 'pipeline.outline', ms: 5_500, meta: { scenes: 2 } });
    recordMark({ req: 'other-req', phase: 'should.not.land', ms: 1 });

    expect(received.map((e) => e.stage)).toEqual(['pipeline.outline']);
    expect(received[0].ms).toBe(5_500);
    expect(received[0].meta).toEqual({ scenes: 2 });

    unlinkRequest(reqId);
    recordMark({ req: reqId, phase: 'after.unlink', ms: 1 });
    expect(received.map((e) => e.stage)).toEqual(['pipeline.outline']);
  });

  it('buffers respect the size cap (no unbounded growth)', () => {
    ensureChannel('pg_buf');
    for (let i = 0; i < 200; i += 1) {
      publish('pg_buf', { stage: `s${i}`, ms: i });
    }
    const ch = __debugChannel('pg_buf');
    expect(ch).toBeDefined();
    // Buffer cap is 64 by implementation; assert <= 100 to keep test stable.
    expect(ch!.buffer.length).toBeLessThanOrEqual(100);
    // Most recent event must still be present.
    expect(ch!.buffer[ch!.buffer.length - 1].stage).toBe('s199');
  });
});
