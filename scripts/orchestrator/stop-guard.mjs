#!/usr/bin/env node
// TM-101 — Orchestrator STOP-condition guard + spend-ledger analyzer.
//
// Runs from .claude/commands/orchestrate.md Step 7-1 (after the existing
// inline STOP / spend.95% / loop-count / openai_cap / ai-qa-final checks).
//
// Five additional STOP signals — when any fires, write .agent-state/STOP with a
// reason line, emit a single telemetry line, and exit non-zero so the
// orchestrator turn ends. All thresholds tunable via env vars (test override).
//
//   1) Quality plateau     — last N bench reports show <Δp mode_match_pct
//      drift → no further progress, halt.
//   2) Error rate spike    — last M task verdicts ≥ R% BLOCK/REQUEST_CHANGES.
//      Suggests orchestrator/agent malfunction, not task difficulty.
//   3) Worktree leak       — `git worktree list` ≥ W (concurrency-limit + slack)
//      indicates leaked worktrees never cleaned up after merge.
//   4) Stale lock          — branch-locks.json entry with started_at older than
//      S hours; zombie task — likely TeamLead crashed mid-flight.
//   5) Cost burst          — OpenAI spend rose ≥ $B inside the last H minutes
//      (sliding window over spend-ledger.jsonl). Catches runaway loops.
//
// Spend ledger format — .agent-state/spend-ledger.jsonl (append-only, JSONL):
//
//   { "ts": "2026-05-13T03:21:18.412Z",
//     "task_id": "TM-101",
//     "model":   "gpt-4o-mini",
//     "tokens_in":  4123,
//     "tokens_out": 812,
//     "cost_usd":   0.0024,
//     "kind":       "openai|anthropic|other" }
//
// The ledger is *additive*; the rolled-up totals in spend.json remain canonical.
// stop-guard.mjs only reads it.
//
// Flags:
//   --dry-run                only print what would happen; never write STOP
//   --state-dir=PATH         override .agent-state/ root (test isolation)
//   --reports-dir=PATH       override wiki/05-reports/ root (test isolation)
//   --json                   emit a single-line JSON result on stdout
//
// Exit codes:
//   0  = no STOP condition fired (idle case — orchestrator continues)
//   42 = STOP fired (orchestrator must exit current iter)
//   1  = unrecoverable error (corrupt state, IO)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

// ─── tunables (env-overridable for tests) ───────────────────────────────────
const DEFAULTS = {
  QUALITY_LOOKBACK: parseInt(process.env.STOP_QUALITY_LOOKBACK || '3', 10),
  QUALITY_DELTA_PP: parseFloat(process.env.STOP_QUALITY_DELTA_PP || '1.0'),
  ERROR_LOOKBACK: parseInt(process.env.STOP_ERROR_LOOKBACK || '5', 10),
  ERROR_RATE_PCT: parseFloat(process.env.STOP_ERROR_RATE_PCT || '60'),
  WORKTREE_MAX: parseInt(process.env.STOP_WORKTREE_MAX || '5', 10),
  STALE_LOCK_HOURS: parseFloat(process.env.STOP_STALE_LOCK_HOURS || '6'),
  COST_BURST_USD: parseFloat(process.env.STOP_COST_BURST_USD || '3'),
  COST_BURST_MIN: parseInt(process.env.STOP_COST_BURST_MIN || '60', 10),
};

function parseArgs(argv) {
  const out = {
    dryRun: false,
    json: false,
    stateDir: null,
    reportsDir: null,
  };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--state-dir=')) out.stateDir = a.slice(12);
    else if (a.startsWith('--reports-dir=')) out.reportsDir = a.slice(14);
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: stop-guard.mjs [--dry-run] [--json] [--state-dir=PATH] [--reports-dir=PATH]',
      );
      process.exit(0);
    } else {
      console.error(`[stop-guard] unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function readJsonSafe(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// ─── signal 1: quality plateau ──────────────────────────────────────────────
// Scan wiki/05-reports/*.md for `mode_match_pct: N` style lines (TM-85/86/106
// bench reports). Take the most recent N reports (lexicographic = chronological
// thanks to YYYY-MM-DD prefix). If max-min < QUALITY_DELTA_PP → plateau.
function checkQualityPlateau(reportsDir) {
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const pcts = [];
  for (const f of files.slice().reverse()) {
    const txt = readFileSync(join(reportsDir, f), 'utf8');
    const m = txt.match(/mode_match_pct[:\s]+([0-9]+(?:\.[0-9]+)?)/i);
    if (m) {
      pcts.push({ file: f, pct: parseFloat(m[1]) });
      if (pcts.length >= DEFAULTS.QUALITY_LOOKBACK) break;
    }
  }
  if (pcts.length < DEFAULTS.QUALITY_LOOKBACK) return null;
  const values = pcts.map((x) => x.pct);
  const drift = Math.max(...values) - Math.min(...values);
  if (drift < DEFAULTS.QUALITY_DELTA_PP) {
    return {
      signal: 'quality_plateau',
      reason: `last ${DEFAULTS.QUALITY_LOOKBACK} bench reports mode_match_pct drift=${drift.toFixed(2)}pp < ${DEFAULTS.QUALITY_DELTA_PP}pp`,
      detail: { samples: pcts },
    };
  }
  return null;
}

// ─── signal 2: error rate spike ─────────────────────────────────────────────
// Read .agent-state/verdict-history.jsonl (lightweight append-only log of
// TeamLead summaries — schema: {ts, task_id, verdict}). If ≥ ERROR_LOOKBACK
// entries and BLOCK+REQUEST_CHANGES ratio ≥ ERROR_RATE_PCT → spike.
function checkErrorRate(stateDir) {
  const path = join(stateDir, 'verdict-history.jsonl');
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-DEFAULTS.ERROR_LOOKBACK);
  if (lines.length < DEFAULTS.ERROR_LOOKBACK) return null;
  let bad = 0;
  for (const ln of lines) {
    try {
      const r = JSON.parse(ln);
      if (r.verdict === 'BLOCK' || r.verdict === 'REQUEST_CHANGES') bad++;
    } catch {
      /* skip malformed */
    }
  }
  const pct = (bad / lines.length) * 100;
  if (pct >= DEFAULTS.ERROR_RATE_PCT) {
    return {
      signal: 'error_rate_spike',
      reason: `last ${lines.length} task verdicts: ${bad}/${lines.length}=${pct.toFixed(0)}% bad ≥ ${DEFAULTS.ERROR_RATE_PCT}%`,
      detail: { bad, total: lines.length, pct },
    };
  }
  return null;
}

// ─── signal 3: worktree leak ────────────────────────────────────────────────
// `git worktree list --porcelain` counts entries. Compare to WORKTREE_MAX.
// Allows GIT_WORKTREE_LIST_CMD env override for tests.
function checkWorktreeLeak() {
  const cmd = process.env.GIT_WORKTREE_LIST_CMD;
  let stdout;
  if (cmd) {
    const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    stdout = r.stdout;
  } else {
    const r = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    if (r.status !== 0) return null;
    stdout = r.stdout;
  }
  const count = stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length;
  if (count >= DEFAULTS.WORKTREE_MAX) {
    return {
      signal: 'worktree_leak',
      reason: `git worktree list count=${count} ≥ ${DEFAULTS.WORKTREE_MAX} — likely leaked after merge`,
      detail: { count },
    };
  }
  return null;
}

// ─── signal 4: stale lock ───────────────────────────────────────────────────
// branch-locks.json entries: { "TM-X": { started_at, ... } }. If any entry's
// started_at is older than STALE_LOCK_HOURS hours, flag it.
function checkStaleLocks(stateDir) {
  const path = join(stateDir, 'branch-locks.json');
  const locks = readJsonSafe(path, {});
  const now = Date.now();
  const stale = [];
  for (const [k, v] of Object.entries(locks)) {
    if (!v || typeof v !== 'object') continue;
    const started = v.started_at ? Date.parse(v.started_at) : NaN;
    if (Number.isNaN(started)) continue;
    const ageH = (now - started) / 3_600_000;
    if (ageH >= DEFAULTS.STALE_LOCK_HOURS) {
      stale.push({ task_id: k, age_hours: ageH });
    }
  }
  if (stale.length > 0) {
    return {
      signal: 'stale_lock',
      reason: `${stale.length} branch-lock entr${stale.length === 1 ? 'y' : 'ies'} older than ${DEFAULTS.STALE_LOCK_HOURS}h (zombie task suspect)`,
      detail: { stale },
    };
  }
  return null;
}

// ─── signal 5: cost burst ───────────────────────────────────────────────────
// Sum cost_usd over spend-ledger.jsonl entries within the last COST_BURST_MIN
// minutes. If ≥ COST_BURST_USD → burst.
function checkCostBurst(stateDir) {
  const path = join(stateDir, 'spend-ledger.jsonl');
  if (!existsSync(path)) return null;
  const cutoff = Date.now() - DEFAULTS.COST_BURST_MIN * 60_000;
  let sum = 0;
  let n = 0;
  for (const ln of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!ln) continue;
    try {
      const r = JSON.parse(ln);
      const t = Date.parse(r.ts);
      if (Number.isNaN(t)) continue;
      if (t < cutoff) continue;
      sum += Number(r.cost_usd) || 0;
      n++;
    } catch {
      /* skip malformed */
    }
  }
  if (sum >= DEFAULTS.COST_BURST_USD) {
    return {
      signal: 'cost_burst',
      reason: `OpenAI/LLM spend $${sum.toFixed(2)} in last ${DEFAULTS.COST_BURST_MIN}min ≥ $${DEFAULTS.COST_BURST_USD}`,
      detail: { sum_usd: sum, entries: n, window_min: DEFAULTS.COST_BURST_MIN },
    };
  }
  return null;
}

// ─── orchestration ──────────────────────────────────────────────────────────
export function runChecks({ stateDir, reportsDir }) {
  const checks = [
    checkQualityPlateau(reportsDir),
    checkErrorRate(stateDir),
    checkWorktreeLeak(),
    checkStaleLocks(stateDir),
    checkCostBurst(stateDir),
  ];
  return checks.filter(Boolean);
}

function writeStop(stateDir, fired) {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  const stopPath = join(stateDir, 'STOP');
  // Don't overwrite an existing STOP — preserve original reason.
  if (existsSync(stopPath)) return { wrote: false, path: stopPath };
  const body =
    `# Written by scripts/orchestrator/stop-guard.mjs at ${new Date().toISOString()}\n` +
    fired
      .map((f) => `${f.signal}: ${f.reason}`)
      .join('\n') +
    '\n';
  writeFileSync(stopPath, body, 'utf8');
  return { wrote: true, path: stopPath };
}

function main() {
  const args = parseArgs(process.argv);
  const stateDir = args.stateDir
    ? resolve(args.stateDir)
    : join(REPO_ROOT, '.agent-state');
  const reportsDir = args.reportsDir
    ? resolve(args.reportsDir)
    : join(REPO_ROOT, 'wiki', '05-reports');

  const fired = runChecks({ stateDir, reportsDir });

  const result = {
    ok: fired.length === 0,
    fired,
    dry_run: args.dryRun,
  };

  if (fired.length === 0) {
    if (args.json) console.log(JSON.stringify(result));
    else console.log('[stop-guard] ok — no STOP conditions fired');
    process.exit(0);
  }

  // At least one signal — log each then write STOP.
  for (const f of fired) {
    console.log(`[stop-guard] ${f.signal}: ${f.reason}`);
  }

  let stopWrite = { wrote: false, path: null };
  if (!args.dryRun) {
    stopWrite = writeStop(stateDir, fired);
    if (stopWrite.wrote) console.log(`[stop-guard] STOP written → ${stopWrite.path}`);
    else console.log(`[stop-guard] STOP already exists at ${stopWrite.path} — preserved`);
  }

  result.stop = stopWrite;
  if (args.json) console.log(JSON.stringify(result));
  process.exit(42);
}

// CLI entry — only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
