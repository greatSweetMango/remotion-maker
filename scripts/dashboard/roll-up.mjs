#!/usr/bin/env node
// TM-104 — Weekly dashboard roll-up.
//
// Collects last-7-days signals across the EasyMake agent company and writes a
// single Markdown summary to `wiki/02-dev/dashboard.md`. Idempotent and side
// effect free outside that one file.
//
// Inputs (all optional — missing sources degrade gracefully, never throw):
//   - git log (last 7d, squash-merge "(#NN)" lines) → merged PR count + cadence
//   - wiki/05-reports/screenshots/TM-{42,55,76,83,85,106}/summary*.json
//     → mode_match_pct, params_loss, unintended_pct, latency p50/p95
//   - .agent-state/spend.json + .agent-state/spend-ledger.jsonl
//     → OpenAI/Anthropic running totals + last-7d window
//   - .agent-state/verdict-history.jsonl (TM-101 format)
//     → escalate / REQUEST_CHANGES / BLOCK rate
//
// Outputs:
//   - wiki/02-dev/dashboard.md         (human-readable rollup, overwritten)
//   - .agent-state/dashboard.json      (machine-readable snapshot, overwritten)
//
// Usage:
//   node scripts/dashboard/roll-up.mjs                 # write artifacts
//   node scripts/dashboard/roll-up.mjs --dry-run       # stdout only
//   node scripts/dashboard/roll-up.mjs --json          # emit JSON to stdout
//   node scripts/dashboard/roll-up.mjs --window-days=7 # custom lookback
//
// Designed for `launchd` weekly cron (Sun 09:00 KST). See README at bottom.
//
// Zero external deps. ESM Node ≥ 18.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

// ─── args ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { dryRun: false, json: false, windowDays: 7 };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--window-days=')) {
      out.windowDays = parseInt(a.slice('--window-days='.length), 10) || 7;
    }
  }
  return out;
}

// ─── helpers ────────────────────────────────────────────────────────────────
function readJsonSafe(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const ln of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!ln) continue;
    try {
      out.push(JSON.parse(ln));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

function fmtPct(v) {
  return v == null ? '—' : `${v}%`;
}

function fmtUsd(v) {
  return v == null ? '—' : `$${Number(v).toFixed(4)}`;
}

function fmtMs(v) {
  return v == null ? '—' : `${Math.round(v)}ms`;
}

// ─── data: git merges (last N days) ─────────────────────────────────────────
// Squash-merge convention emits one commit per PR with "(#NN)" suffix.
function collectMerges(windowDays) {
  const since = `${windowDays} days ago`;
  const r = spawnSync(
    'git',
    ['log', `--since=${since}`, '--pretty=%h|%ci|%s'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (r.status !== 0) return { count: 0, prs: [], cadenceHours: null };
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  const prs = [];
  const prRe = /\(#(\d+)\)\s*$/;
  for (const ln of lines) {
    const [sha, ci, ...rest] = ln.split('|');
    const subject = rest.join('|');
    const m = subject.match(prRe);
    if (!m) continue;
    prs.push({ sha, ci, pr: parseInt(m[1], 10), subject });
  }
  // crude cadence: span / count
  let cadenceHours = null;
  if (prs.length >= 2) {
    const oldest = Date.parse(prs[prs.length - 1].ci);
    const newest = Date.parse(prs[0].ci);
    if (!Number.isNaN(oldest) && !Number.isNaN(newest)) {
      cadenceHours =
        Math.round(((newest - oldest) / 3_600_000 / prs.length) * 10) / 10;
    }
  }
  return { count: prs.length, prs, cadenceHours };
}

// ─── data: bench summaries ──────────────────────────────────────────────────
// Walk wiki/05-reports/screenshots/*/summary*.json and extract a normalized
// record per file. Newest first.
function collectBenchSummaries(windowDays) {
  const root = join(REPO_ROOT, 'wiki', '05-reports', 'screenshots');
  if (!existsSync(root)) return [];
  const cutoff = Date.now() - windowDays * 86_400_000;
  const records = [];
  for (const dir of readdirSync(root)) {
    const dpath = join(root, dir);
    let stats;
    try {
      stats = statSync(dpath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    for (const f of readdirSync(dpath)) {
      if (!/^summary.*\.json$/.test(f)) continue;
      const fpath = join(dpath, f);
      const data = readJsonSafe(fpath);
      if (!data) continue;
      const startedAt = Date.parse(data.startedAt || data.finishedAt || '');
      // Honor window if we have a timestamp; otherwise include (treat as legacy)
      if (!Number.isNaN(startedAt) && startedAt < cutoff) continue;
      const rec = {
        task: dir,
        file: f,
        startedAt: data.startedAt || data.finishedAt || null,
        modeMatchPct:
          data?.modeMatch?.pct ??
          data?.overallAccuracy?.pct ??
          null,
        totalPrompts:
          data?.totalPrompts ?? data?.modeMatch?.total ?? null,
        paramsLost: data?.paramsPreservation?.paramsLostTotal ?? null,
        unintendedPct:
          data?.paramsPreservation?.unintendedPct ??
          (data?.paramsPreservation?.unintendedChangeZeroRate != null
            ? Math.round(
                (1 - data.paramsPreservation.unintendedChangeZeroRate) * 1000,
              ) / 10
            : null),
        latencyGenerateP50:
          data?.latency?.generate?.p50Ms ?? null,
        latencyEditP50:
          data?.latency?.edit_overall?.p50Ms ?? data?.latency?.edit?.p50Ms ?? null,
        verdict: data?.verdict ?? null,
      };
      records.push(rec);
    }
  }
  records.sort((a, b) => {
    const ta = Date.parse(a.startedAt || '');
    const tb = Date.parse(b.startedAt || '');
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
  return records;
}

// ─── data: spend ────────────────────────────────────────────────────────────
function collectSpend(windowDays) {
  const stateDir = join(REPO_ROOT, '.agent-state');
  const spend = readJsonSafe(join(stateDir, 'spend.json'), {});
  const ledger = readJsonlSafe(join(stateDir, 'spend-ledger.jsonl'));
  const cutoff = Date.now() - windowDays * 86_400_000;
  const byKind = {};
  let total = 0;
  let entries = 0;
  for (const r of ledger) {
    const t = Date.parse(r.ts || '');
    if (Number.isNaN(t) || t < cutoff) continue;
    const kind = r.kind || 'other';
    const c = Number(r.cost_usd) || 0;
    byKind[kind] = (byKind[kind] || 0) + c;
    total += c;
    entries++;
  }
  return {
    ledger_window_total_usd: Math.round(total * 1_000_000) / 1_000_000,
    ledger_window_entries: entries,
    ledger_by_kind: byKind,
    openai_total_usd: spend?.openai_total_usd ?? null,
    weekly_budget_usd: spend?.weekly_budget_usd ?? null,
    spend_current: spend?.current ?? null,
  };
}

// ─── data: verdict history ──────────────────────────────────────────────────
function collectVerdicts(windowDays) {
  const path = join(REPO_ROOT, '.agent-state', 'verdict-history.jsonl');
  const rows = readJsonlSafe(path);
  const cutoff = Date.now() - windowDays * 86_400_000;
  let total = 0;
  const counts = { APPROVE: 0, REQUEST_CHANGES: 0, BLOCK: 0, OTHER: 0 };
  let escalate = 0;
  for (const r of rows) {
    const t = Date.parse(r.ts || '');
    if (Number.isNaN(t) || t < cutoff) continue;
    total++;
    const v = r.verdict || 'OTHER';
    if (counts[v] != null) counts[v]++;
    else counts.OTHER++;
    if (r.escalated === true) escalate++;
  }
  return {
    total,
    counts,
    escalate,
    escalate_pct: pct(escalate, total),
    bad_pct: pct(counts.REQUEST_CHANGES + counts.BLOCK, total),
  };
}

// ─── aggregation ────────────────────────────────────────────────────────────
function aggregate(windowDays) {
  const merges = collectMerges(windowDays);
  const benches = collectBenchSummaries(windowDays);
  const spend = collectSpend(windowDays);
  const verdicts = collectVerdicts(windowDays);

  // Quality summary: average + trend (newest minus oldest in window)
  const pcts = benches
    .map((b) => b.modeMatchPct)
    .filter((v) => typeof v === 'number');
  const avgModeMatch = pcts.length
    ? Math.round((pcts.reduce((s, x) => s + x, 0) / pcts.length) * 10) / 10
    : null;
  const trendModeMatch =
    pcts.length >= 2 ? Math.round((pcts[0] - pcts[pcts.length - 1]) * 10) / 10 : null;

  const paramsLossTotal = benches
    .map((b) => b.paramsLost)
    .filter((v) => typeof v === 'number')
    .reduce((s, x) => s + x, 0);
  const unintendedPcts = benches
    .map((b) => b.unintendedPct)
    .filter((v) => typeof v === 'number');
  const avgUnintendedPct = unintendedPcts.length
    ? Math.round(
        (unintendedPcts.reduce((s, x) => s + x, 0) / unintendedPcts.length) * 10,
      ) / 10
    : null;

  const genP50s = benches
    .map((b) => b.latencyGenerateP50)
    .filter((v) => typeof v === 'number');
  const avgGenP50 = genP50s.length
    ? Math.round(genP50s.reduce((s, x) => s + x, 0) / genP50s.length)
    : null;
  const editP50s = benches
    .map((b) => b.latencyEditP50)
    .filter((v) => typeof v === 'number');
  const avgEditP50 = editP50s.length
    ? Math.round(editP50s.reduce((s, x) => s + x, 0) / editP50s.length)
    : null;

  return {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    merges,
    quality: {
      benches_count: benches.length,
      avg_mode_match_pct: avgModeMatch,
      trend_mode_match_pp: trendModeMatch,
      params_loss_total: paramsLossTotal,
      avg_unintended_pct: avgUnintendedPct,
      latency_generate_p50_ms: avgGenP50,
      latency_edit_p50_ms: avgEditP50,
      samples: benches,
    },
    spend,
    verdicts,
  };
}

// ─── markdown rendering ─────────────────────────────────────────────────────
function renderMarkdown(agg) {
  const date = agg.generated_at.slice(0, 10);
  const w = agg.window_days;
  const m = agg.merges;
  const q = agg.quality;
  const s = agg.spend;
  const v = agg.verdicts;

  const samplesTable =
    q.samples.length === 0
      ? '_(no bench results in window)_'
      : [
          '| task | file | mode_match | params_loss | unintended | gen p50 | edit p50 | verdict |',
          '|---|---|---|---|---|---|---|---|',
          ...q.samples.slice(0, 10).map(
            (r) =>
              `| ${r.task} | ${r.file} | ${fmtPct(r.modeMatchPct)} | ${
                r.paramsLost ?? '—'
              } | ${fmtPct(r.unintendedPct)} | ${fmtMs(
                r.latencyGenerateP50,
              )} | ${fmtMs(r.latencyEditP50)} | ${r.verdict ?? '—'} |`,
          ),
        ].join('\n');

  const prsTable =
    m.prs.length === 0
      ? '_(no merged PRs in window)_'
      : [
          '| PR | when | subject |',
          '|---|---|---|',
          ...m.prs.slice(0, 20).map(
            (p) => `| #${p.pr} | ${p.ci.slice(0, 10)} | ${p.subject.replace(/\|/g, '\\|')} |`,
          ),
        ].join('\n');

  const spendKind = Object.entries(s.ledger_by_kind || {})
    .map(([k, val]) => `${k}=$${val.toFixed(4)}`)
    .join(', ') || '—';

  return `---
title: Dashboard (auto)
updated: ${date}
window_days: ${w}
generated_by: scripts/dashboard/roll-up.mjs
tags: [dev, dashboard, auto]
status: active
---

# Dashboard — last ${w} days

> Auto-generated. Do not edit by hand — re-run \`node scripts/dashboard/roll-up.mjs\`.
> Generated at \`${agg.generated_at}\`.

## Throughput

- **Merged PRs (window):** ${m.count}
- **Average cadence:** ${m.cadenceHours == null ? '—' : `${m.cadenceHours}h / PR`}

${prsTable}

## Quality (bench rollup)

- **Bench summaries in window:** ${q.benches_count}
- **Avg mode_match_pct:** ${fmtPct(q.avg_mode_match_pct)}
- **Trend (newest − oldest):** ${q.trend_mode_match_pp == null ? '—' : `${q.trend_mode_match_pp >= 0 ? '+' : ''}${q.trend_mode_match_pp}pp`}
- **Σ params_loss:** ${q.params_loss_total}
- **Avg unintended%:** ${fmtPct(q.avg_unintended_pct)}
- **Avg latency p50 (generate):** ${fmtMs(q.latency_generate_p50_ms)}
- **Avg latency p50 (edit):** ${fmtMs(q.latency_edit_p50_ms)}

${samplesTable}

## Spend

- **Ledger window total:** ${fmtUsd(s.ledger_window_total_usd)} (${s.ledger_window_entries} entries)
- **By kind:** ${spendKind}
- **OpenAI cumulative (spend.json):** ${fmtUsd(s.openai_total_usd)}
- **Weekly budget:** ${s.weekly_budget_usd == null ? '—' : `$${s.weekly_budget_usd}`}

## Agent verdicts

- **Total verdicts (window):** ${v.total}
- **APPROVE:** ${v.counts.APPROVE} / **REQUEST_CHANGES:** ${v.counts.REQUEST_CHANGES} / **BLOCK:** ${v.counts.BLOCK} / **OTHER:** ${v.counts.OTHER}
- **Escalate rate:** ${fmtPct(v.escalate_pct)} (${v.escalate} escalated)
- **Bad rate (REQUEST_CHANGES + BLOCK):** ${fmtPct(v.bad_pct)}

---

_Sources: \`git log\`, \`wiki/05-reports/screenshots/*/summary*.json\`, \`.agent-state/spend.json\`, \`.agent-state/spend-ledger.jsonl\`, \`.agent-state/verdict-history.jsonl\`._
`;
}

// ─── main ───────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const agg = aggregate(args.windowDays);
  const md = renderMarkdown(agg);

  if (args.json) {
    console.log(JSON.stringify(agg, null, 2));
    return;
  }

  if (args.dryRun) {
    process.stdout.write(md);
    return;
  }

  const wikiPath = join(REPO_ROOT, 'wiki', '02-dev', 'dashboard.md');
  const jsonPath = join(REPO_ROOT, '.agent-state', 'dashboard.json');
  mkdirSync(dirname(wikiPath), { recursive: true });
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(wikiPath, md, 'utf8');
  writeFileSync(jsonPath, JSON.stringify(agg, null, 2), 'utf8');
  console.log(`[roll-up] wrote ${wikiPath}`);
  console.log(`[roll-up] wrote ${jsonPath}`);
  console.log(
    `[roll-up] window=${args.windowDays}d merges=${agg.merges.count} benches=${agg.quality.benches_count} avg_mode_match=${agg.quality.avg_mode_match_pct ?? 'n/a'}`,
  );
}

main();
