import { FpsSampler, pickDownsample } from '@/lib/perf/fps-sampler';

describe('FpsSampler', () => {
  it('returns null fps before two samples are recorded', () => {
    const s = new FpsSampler();
    expect(s.read(0).fps).toBeNull();
    s.record(0);
    expect(s.read(0).fps).toBeNull();
  });

  it('measures ~60fps when frames arrive every 16.67ms over a full window', () => {
    const s = new FpsSampler({ windowMs: 1000, threshold: 30 });
    const interval = 1000 / 60;
    for (let i = 0; i <= 60; i++) {
      s.record(i * interval);
    }
    const snap = s.read(60 * interval);
    expect(snap.fps).not.toBeNull();
    expect(snap.fps!).toBeGreaterThan(58);
    expect(snap.fps!).toBeLessThan(62);
    expect(snap.isLow).toBe(false);
  });

  it('flags isLow when sustained fps drops below threshold for the full window', () => {
    const s = new FpsSampler({ windowMs: 1000, threshold: 30 });
    // 20 fps -> 50ms intervals.
    for (let i = 0; i <= 20; i++) {
      s.record(i * 50);
    }
    const snap = s.read(20 * 50);
    expect(snap.fps!).toBeGreaterThan(18);
    expect(snap.fps!).toBeLessThan(22);
    expect(snap.isLow).toBe(true);
  });

  it('does NOT flag isLow on a brief stutter (window not yet full)', () => {
    const s = new FpsSampler({ windowMs: 2000, threshold: 30 });
    // Only 200ms of low-fps samples — window 80% threshold is 1600ms.
    for (let i = 0; i <= 4; i++) {
      s.record(i * 50);
    }
    const snap = s.read(200);
    // Even though instantaneous fps is ~20, window isn't full so no latch.
    expect(snap.isLow).toBe(false);
  });

  it('drops out-of-window samples', () => {
    const s = new FpsSampler({ windowMs: 1000, threshold: 30 });
    s.record(0);
    s.record(100);
    s.record(200);
    // Read 5s later — all old samples should be evicted.
    const snap = s.read(5000);
    expect(snap.sampleCount).toBe(0);
    expect(snap.fps).toBeNull();
  });

  it('reset clears samples', () => {
    const s = new FpsSampler();
    s.record(0);
    s.record(16);
    s.reset();
    expect(s.read(20).sampleCount).toBe(0);
  });
});

describe('pickDownsample', () => {
  it('drops 60fps to 30fps', () => {
    const out = pickDownsample({ fps: 60, width: 720, height: 720 });
    expect(out).toEqual({ fps: 30, width: 720, height: 720 });
  });

  it('scales 1080p to 720p preserving aspect', () => {
    const out = pickDownsample({ fps: 30, width: 1920, height: 1080 });
    expect(out).not.toBeNull();
    expect(out!.fps).toBe(30);
    expect(out!.width).toBe(1280);
    expect(out!.height).toBe(720);
  });

  it('applies both fps and resolution drop together', () => {
    const out = pickDownsample({ fps: 60, width: 1920, height: 1080 });
    expect(out).toEqual({ fps: 30, width: 1280, height: 720 });
  });

  it('returns null when nothing to do (already at floor)', () => {
    expect(pickDownsample({ fps: 30, width: 720, height: 720 })).toBeNull();
    expect(pickDownsample({ fps: 24, width: 640, height: 360 })).toBeNull();
  });

  it('keeps even pixel dimensions', () => {
    const out = pickDownsample({ fps: 30, width: 1500, height: 1001 });
    expect(out).not.toBeNull();
    expect(out!.width % 2).toBe(0);
    expect(out!.height % 2).toBe(0);
  });
});
