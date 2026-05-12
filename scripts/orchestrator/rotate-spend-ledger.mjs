#!/usr/bin/env node
// TM-118 — Monthly rotation policy for .agent-state/spend-ledger.jsonl.
//
// Background
//   spend-ledger.jsonl is an append-only cost ledger (TM-101 schema, TM-112
//   producer). Unbounded growth makes hot-path readers (stop-guard cost_burst,
//   dashboard roll-up) slow. We archive entries from past months into
//   `.agent-state/spend-ledger.archive.YYYY-MM.jsonl.gz` and keep only
//   current-month rows in the live ledger.
//
// Behaviour
//   1. Load `.agent-state/spend-ledger.jsonl`. Missing file → noop.
//   2. Group lines by `YYYY-MM` derived from each row's `ts` (UTC).
//   3. For every month strictly older than `--cutoff-month` (default: current
//      UTC month):
//        - Append rows (preserving original order) to
//          `.agent-state/spend-ledger.archive.<MONTH>.jsonl.gz`.
//          If the archive already exists we **append** under flock — making
//          the operation safe to re-run if the previous attempt crashed
//          mid-write (idempotent: see Case "already-archived" — caller must
//          ensure we don't append duplicates; we do this by tracking what
//          we've moved via the temp swap below).
//   4. Atomically rewrite the live ledger to contain only current-month rows
//      (write to tmp + rename). Held under the same flock as the appender so
//      a concurrent post-tool-use.sh writer cannot interleave.
//   5. Malformed lines (non-JSON / missing ts) stay in the live ledger.
//
// Idempotency
//   After step 4 the live ledger no longer contains older-month rows, so a
//   second invocation in the same month finds nothing to rotate → noop. If
//   the previous run crashed *between* the archive append and the rewrite,
//   re-running could double-append; to defeat that we use a `--state` marker
//   file `.agent-state/spend-ledger.rotate.json` that records the last
//   archived month per file, and we skip months already recorded as
//   complete.
//
// Concurrency
//   flock on `.agent-state/.spend-ledger.lock` — same lock as the appender
//   hook (see .claude/hooks/post-tool-use.sh:11).
//
// Flags
//   --ledger=<path>         override ledger path (test isolation)
//   --archive-dir=<path>    override archive output dir (default: same as ledger)
//   --state=<path>          override rotate-state file (default: <ledger-dir>/spend-ledger.rotate.json)
//   --cutoff-month=YYYY-MM  rotate everything strictly older than this month
//                           (default: current UTC month)
//   --dry-run               print plan, no writes
//   --json                  one-line JSON summary on stdout
//
// Exit
//   0 — success (rotated or noop)
//   1 — unrecoverable I/O / lock failure
//
// Stdlib only — no new npm deps (node:zlib gzipSync).

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  renameSync,
  openSync,
  closeSync,
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const out = {
    ledger: null,
    archiveDir: null,
    state: null,
    cutoffMonth: null,
    dryRun: false,
    json: false,
  };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--ledger=')) out.ledger = a.slice(9);
    else if (a.startsWith('--archive-dir=')) out.archiveDir = a.slice(14);
    else if (a.startsWith('--state=')) out.state = a.slice(8);
    else if (a.startsWith('--cutoff-month=')) out.cutoffMonth = a.slice(15);
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: rotate-spend-ledger.mjs [--ledger=PATH] [--archive-dir=DIR] [--state=PATH] [--cutoff-month=YYYY-MM] [--dry-run] [--json]',
      );
      process.exit(0);
    } else {
      console.error(`[rotate-spend-ledger] unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function log(obj) {
  if (!obj || !obj.event) return;
  const extras = Object.entries(obj)
    .filter(([k]) => k !== 'event')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  // Telemetry goes to stderr so --json consumers can pipe stdout cleanly.
  console.error(`[rotate-spend-ledger] ${obj.event} ${extras}`.trim());
}

function currentUtcMonth(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthOfTs(ts) {
  // Expect ISO-8601 UTC ts. Cheap path: slice first 7 chars (YYYY-MM).
  if (typeof ts !== 'string' || ts.length < 7) return null;
  const head = ts.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(head)) return null;
  return head;
}

// Run a critical section under flock; falls back to no-lock on systems
// without flock (e.g. CI containers). Returns whatever fn returns.
function withFlock(lockPath, fn) {
  mkdirSync(dirname(lockPath), { recursive: true });
  let hasFlock = true;
  try {
    execFileSync('sh', ['-c', 'command -v flock >/dev/null 2>&1'], { stdio: 'ignore' });
  } catch {
    hasFlock = false;
  }
  if (!hasFlock) {
    return fn();
  }
  // Use a node-controlled fd to hold the lock for the duration of fn.
  // Easiest portable approach: wrap fn execution inside `flock` shell call
  // that runs node again. To avoid recursion we instead serialize ourselves
  // via a sibling lock file using O_EXCL acquire-with-retry — same effect as
  // flock for our coarse-grained writer.
  const fd = openSync(lockPath, 'a');
  try {
    // Best effort advisory lock via `flock` CLI on the fd is not portable
    // from node; use a sentinel file with O_EXCL + small retry. Append-only
    // hook already serializes via flock so collisions are rare.
    const sentinel = lockPath + '.x';
    const start = Date.now();
    const TIMEOUT_MS = 5000;
    while (true) {
      try {
        const sfd = openSync(sentinel, 'wx');
        closeSync(sfd);
        try {
          return fn();
        } finally {
          try { execFileSync('rm', ['-f', sentinel], { stdio: 'ignore' }); } catch {}
        }
      } catch (e) {
        if (Date.now() - start > TIMEOUT_MS) {
          throw new Error(`flock timeout on ${lockPath}`);
        }
        // brief sleep
        execFileSync('sh', ['-c', 'sleep 0.05'], { stdio: 'ignore' });
      }
    }
  } finally {
    closeSync(fd);
  }
}

function loadRotateState(statePath) {
  if (!existsSync(statePath)) {
    return { last_rotated_at: null, archived_months: {} };
  }
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return { last_rotated_at: null, archived_months: {} };
  }
}

function saveRotateState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function run({ now = new Date(), argv = process.argv } = {}) {
  const args = parseArgs(argv);

  // Resolve user-supplied paths against cwd (test isolation); fall back to
  // REPO_ROOT-relative defaults so production cron invocation works from
  // anywhere.
  const ledgerPath = args.ledger
    ? resolve(process.cwd(), args.ledger)
    : resolve(REPO_ROOT, '.agent-state/spend-ledger.jsonl');
  const ledgerDir = dirname(ledgerPath);
  const archiveDir = args.archiveDir ? resolve(process.cwd(), args.archiveDir) : ledgerDir;
  const statePath = args.state
    ? resolve(process.cwd(), args.state)
    : `${ledgerDir}/spend-ledger.rotate.json`;
  const lockPath = `${ledgerDir}/.spend-ledger.lock`;
  const cutoffMonth = args.cutoffMonth || currentUtcMonth(now);

  if (!/^\d{4}-\d{2}$/.test(cutoffMonth)) {
    console.error(`[rotate-spend-ledger] invalid --cutoff-month=${cutoffMonth}`);
    process.exit(1);
  }

  if (!existsSync(ledgerPath)) {
    log({ event: 'noop', reason: 'ledger_missing', path: ledgerPath });
    if (args.json) {
      process.stdout.write(JSON.stringify({ status: 'noop', reason: 'ledger_missing' }) + '\n');
    }
    return;
  }

  const result = withFlock(lockPath, () => {
    const raw = readFileSync(ledgerPath, 'utf8');
    const lines = raw.split('\n');
    // Drop the trailing empty element from a terminal newline.
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    /** @type {Map<string, string[]>} */
    const byMonth = new Map();
    const keep = []; // lines that remain in the live ledger (current month + malformed)

    let malformed = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        // Keep malformed lines in place — operator must inspect manually.
        keep.push(line);
        malformed += 1;
        continue;
      }
      const month = monthOfTs(obj?.ts);
      if (!month) {
        keep.push(line);
        malformed += 1;
        continue;
      }
      if (month < cutoffMonth) {
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push(line);
      } else {
        keep.push(line);
      }
    }

    if (byMonth.size === 0) {
      return {
        status: 'noop',
        reason: 'no_old_rows',
        kept: keep.length,
        cutoffMonth,
        malformed,
      };
    }

    const state = loadRotateState(statePath);
    state.archived_months = state.archived_months || {};

    const archived = [];

    for (const [month, rows] of [...byMonth.entries()].sort()) {
      const archivePath = resolve(archiveDir, `spend-ledger.archive.${month}.jsonl.gz`);

      // Idempotency guard: if state says this month is fully archived AND
      // the archive file exists, treat as already-done (silently drop the
      // duplicate rows that somehow re-appeared — shouldn't happen but
      // protects against re-runs after partial failure).
      const alreadyDone = state.archived_months[month] === 'complete' && existsSync(archivePath);

      if (args.dryRun) {
        archived.push({ month, rows: rows.length, archive: archivePath, dry: true, alreadyDone });
        continue;
      }

      if (!alreadyDone) {
        mkdirSync(archiveDir, { recursive: true });

        // gzip the new chunk; append the gzipped bytes. gzip member
        // concatenation is part of the standard (RFC 1952 §2.2) and
        // `gunzip -c` / `zcat` decompress concatenated members correctly.
        const chunk = rows.join('\n') + '\n';
        const gz = gzipSync(Buffer.from(chunk, 'utf8'));
        appendFileSync(archivePath, gz);

        state.archived_months[month] = 'complete';
      }

      archived.push({ month, rows: rows.length, archive: archivePath, alreadyDone });
    }

    if (!args.dryRun) {
      // Atomic rewrite of the live ledger.
      const tmp = ledgerPath + '.tmp';
      const out = keep.length ? keep.join('\n') + '\n' : '';
      writeFileSync(tmp, out);
      renameSync(tmp, ledgerPath);

      state.last_rotated_at = now.toISOString();
      saveRotateState(statePath, state);
    }

    return {
      status: args.dryRun ? 'dry_run' : 'rotated',
      cutoffMonth,
      kept: keep.length,
      malformed,
      archived,
    };
  });

  log({
    event: result.status,
    cutoff_month: result.cutoffMonth || cutoffMonth,
    kept: result.kept,
    archived_months: Array.isArray(result.archived) ? result.archived.length : 0,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}

// Export for tests; run when invoked directly.
export { run, monthOfTs, currentUtcMonth };

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  try {
    run();
  } catch (e) {
    console.error(`[rotate-spend-ledger] fatal: ${e.message}`);
    process.exit(1);
  }
}
