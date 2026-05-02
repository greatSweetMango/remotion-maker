#!/usr/bin/env node
/**
 * TM-83 — concurrent vs sequential /api/generate perf driver.
 *
 * Why this exists:
 *   We need to know what happens to the live edit/generate path when N users
 *   hit it at once: memory growth on the dev server (RSS), p50/p90/p99 wall
 *   latency, throughput, and whether any per-user race shows up (NextAuth
 *   session lookup, monthly-quota increment, prisma row contention).
 *
 * Method:
 *   1) auto-login as the dev user, capture authjs.session-token
 *   2) capture dev server RSS before tests (ps -o rss)
 *   3) run 10 concurrent POSTs (Promise.all), record per-call wall ms
 *   4) cooldown
 *   5) run 30 sequential POSTs, record per-call wall ms
 *   6) capture dev server RSS after, compute delta
 *   7) emit summary JSON (and pretty-printed table) to stdout AND
 *      __tests__/perf/tm-83-results.json for the wiki retro to attach.
 *
 * No external deps (axios/k6 forbidden by task spec). Uses Node 22 fetch.
 *
 * Usage:
 *   PORT=3083 node __tests__/perf/tm-83-concurrent.mjs
 *
 * Env knobs:
 *   PORT          dev server port (default 3083)
 *   CONCURRENT_N  default 10
 *   SEQUENTIAL_N  default 30
 *   PROMPT        the user prompt to send (default short generic prompt)
 *   DEV_PID       optional pid override; otherwise we lsof :PORT
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 3083);
const CONCURRENT_N = Number(process.env.CONCURRENT_N ?? 10);
const SEQUENTIAL_N = Number(process.env.SEQUENTIAL_N ?? 30);
const BASE = `http://localhost:${PORT}`;
const PROMPT = process.env.PROMPT ?? 'a simple bouncing ball animation with a soft shadow';

function log(...a) {
  console.log('[tm-83]', ...a);
}

function findDevPid() {
  if (process.env.DEV_PID) return Number(process.env.DEV_PID);
  const out = spawnSync('lsof', ['-iTCP:' + PORT, '-sTCP:LISTEN', '-n', '-P'], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  // pick the row with COMMAND=node
  const lines = out.stdout.split('\n').filter((l) => /\bnode\b/.test(l));
  if (!lines.length) return null;
  const pid = Number(lines[0].trim().split(/\s+/)[1]);
  return Number.isFinite(pid) ? pid : null;
}

function rssKb(pid) {
  if (!pid) return null;
  const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  const v = Number(out.stdout.trim());
  return Number.isFinite(v) ? v : null;
}

async function autoLogin() {
  // 1st hop returns Set-Cookie via redirect chain; we just follow.
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/`, {
    redirect: 'manual',
  });
  // Auth.js sets the session-token on this 307
  const sc = res.headers.getSetCookie?.() ?? [];
  const tok = sc
    .map((c) => /authjs\.session-token=([^;]+)/.exec(c)?.[1])
    .find(Boolean);
  if (!tok) {
    throw new Error(
      `auto-login: no session-token (status=${res.status}, set-cookie count=${sc.length})`,
    );
  }
  return tok;
}

async function callGenerate(token) {
  const t0 = performance.now();
  let status = 0;
  let kind = 'unknown';
  let errMsg = null;
  let bytes = 0;
  try {
    const res = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `authjs.session-token=${token}`,
      },
      body: JSON.stringify({ prompt: PROMPT }),
    });
    status = res.status;
    const text = await res.text();
    bytes = text.length;
    try {
      const j = JSON.parse(text);
      kind = j.type ?? (j.error ? 'error' : 'unknown');
      if (j.error) errMsg = String(j.error).slice(0, 200);
    } catch {
      kind = 'non-json';
      errMsg = text.slice(0, 200);
    }
  } catch (e) {
    errMsg = String(e?.message ?? e);
    kind = 'fetch-error';
  }
  return { wallMs: performance.now() - t0, status, kind, bytes, errMsg };
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[i] * 100) / 100;
}

function summarize(label, runs) {
  const ok = runs.filter((r) => r.status === 200 && (r.kind === 'generate' || r.kind === 'clarify'));
  const wall = ok.map((r) => r.wallMs).sort((a, b) => a - b);
  return {
    label,
    n: runs.length,
    ok: ok.length,
    failed: runs.length - ok.length,
    statuses: runs.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}),
    kinds: runs.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {}),
    bytesTotal: runs.reduce((s, r) => s + r.bytes, 0),
    wallMs: {
      min: Math.round((wall[0] ?? 0) * 100) / 100,
      p50: pct(wall, 50),
      p90: pct(wall, 90),
      p99: pct(wall, 99),
      max: Math.round((wall.at(-1) ?? 0) * 100) / 100,
      avg: wall.length ? Math.round((wall.reduce((a, b) => a + b, 0) / wall.length) * 100) / 100 : null,
    },
    errors: runs.filter((r) => r.errMsg).map((r) => ({ status: r.status, kind: r.kind, msg: r.errMsg })),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const pid = findDevPid();
  log('dev pid =', pid, 'port =', PORT);
  if (!pid) {
    log('WARN: cannot resolve dev pid; RSS measurement will be null.');
  }
  const rssBefore = rssKb(pid);
  log('rss before =', rssBefore, 'KB');

  log('auth: auto-login');
  const token = await autoLogin();
  log('auth: ok (token len =', token.length, ')');

  // ---- Concurrent batch (10 simultaneous) ----
  log(`concurrent: launching ${CONCURRENT_N} simultaneous POSTs...`);
  const concStart = performance.now();
  const concurrentRuns = await Promise.all(
    Array.from({ length: CONCURRENT_N }, () => callGenerate(token)),
  );
  const concWall = performance.now() - concStart;
  log(`concurrent: done in ${Math.round(concWall)}ms`);
  const rssAfterConc = rssKb(pid);
  log('rss after concurrent =', rssAfterConc, 'KB');

  // ---- Cooldown to let any pending IO drain ----
  await new Promise((r) => setTimeout(r, 1500));

  // ---- Sequential batch (30 one-after-another) ----
  log(`sequential: launching ${SEQUENTIAL_N} one-by-one POSTs...`);
  const seqStart = performance.now();
  const sequentialRuns = [];
  for (let i = 0; i < SEQUENTIAL_N; i++) {
    sequentialRuns.push(await callGenerate(token));
    if ((i + 1) % 5 === 0) log(`  sequential: ${i + 1}/${SEQUENTIAL_N}`);
  }
  const seqWall = performance.now() - seqStart;
  log(`sequential: done in ${Math.round(seqWall)}ms`);
  const rssAfter = rssKb(pid);
  log('rss after sequential =', rssAfter, 'KB');

  const concSummary = summarize('concurrent-' + CONCURRENT_N, concurrentRuns);
  const seqSummary = summarize('sequential-' + SEQUENTIAL_N, sequentialRuns);

  // ---- Race-condition / queue-lock checks ----
  // 1) NextAuth: every request was authenticated — if any returned 401 we
  //    have a session-table race. (We share a single token across all calls.)
  const auth401 = [...concurrentRuns, ...sequentialRuns].filter((r) => r.status === 401).length;
  // 2) Quota race: monthlyUsage is incremented per request. If we exceeded the
  //    free-tier monthly limit during the run and started getting 429, that's
  //    EXPECTED (not a race). What WOULD be a race is two requests reading the
  //    same usage value and both succeeding past the limit — we can't observe
  //    that here without DB introspection, but we surface 429 counts so the
  //    retro can correlate.
  const status429 = [...concurrentRuns, ...sequentialRuns].filter((r) => r.status === 429).length;
  // 3) 5xx surface: prisma deadlock / OpenAI 5xx / unhandled.
  const status5xx = [...concurrentRuns, ...sequentialRuns].filter((r) => r.status >= 500).length;

  const result = {
    task: 'TM-83',
    startedAt,
    finishedAt: new Date().toISOString(),
    base: BASE,
    devPid: pid,
    rssKb: {
      before: rssBefore,
      afterConcurrent: rssAfterConc,
      afterSequential: rssAfter,
      deltaTotalKb: rssBefore != null && rssAfter != null ? rssAfter - rssBefore : null,
    },
    concurrent: { wallMsTotal: Math.round(concWall), ...concSummary },
    sequential: { wallMsTotal: Math.round(seqWall), ...seqSummary },
    raceChecks: {
      auth401,
      status429,
      status5xx,
      verdict:
        auth401 === 0 && status5xx === 0
          ? 'no-observed-race'
          : 'investigate (auth401 or 5xx present)',
    },
    speedup:
      seqSummary.wallMs.avg && concSummary.wallMs.avg
        ? Math.round((seqSummary.wallMs.avg / concSummary.wallMs.avg) * 100) / 100
        : null,
  };

  const outPath = resolve(import.meta.dirname, 'tm-83-results.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  log('wrote', outPath);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('[tm-83] FATAL', e);
  process.exit(1);
});
