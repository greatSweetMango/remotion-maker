/**
 * TM-46 r7 — RAG-ON vs RAG-OFF score comparison.
 *
 * Reads:
 *   __tests__/benchmarks/results/tm-46-r7/rag-on/scores.json
 *   __tests__/benchmarks/results/tm-46-r7/rag-off/scores.json
 *
 * Outputs a markdown summary on stdout (consumed by the wiki report).
 */
import * as fs from 'fs';
import * as path from 'path';

interface FrameScore { layout: number; typography: number; motion: number; fidelity: number }
interface PromptScore {
  id: string;
  category: string;
  overall_score: number;
  judge: { frames: FrameScore[] };
}
interface ScoresFile {
  ran_at: string; n: number; avg_overall: number;
  results: PromptScore[];
}

const ROOT = path.join(__dirname, 'results', 'tm-46-r7');
const onPath = path.join(ROOT, 'rag-on', 'scores.json');
const offPath = path.join(ROOT, 'rag-off', 'scores.json');

function load(p: string): ScoresFile | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function avgAxis(rs: PromptScore[]): { layout: number; typography: number; motion: number; fidelity: number } {
  const sums = { layout: 0, typography: 0, motion: 0, fidelity: 0 };
  let n = 0;
  for (const r of rs) {
    for (const f of r.judge.frames) {
      sums.layout += f.layout; sums.typography += f.typography;
      sums.motion += f.motion; sums.fidelity += f.fidelity;
      n++;
    }
  }
  if (n === 0) return sums;
  return {
    layout: +(sums.layout / n).toFixed(2),
    typography: +(sums.typography / n).toFixed(2),
    motion: +(sums.motion / n).toFixed(2),
    fidelity: +(sums.fidelity / n).toFixed(2),
  };
}

function byCategory(rs: PromptScore[]): Record<string, { n: number; avg: number }> {
  const buckets: Record<string, number[]> = {};
  for (const r of rs) {
    (buckets[r.category] ||= []).push(r.overall_score);
  }
  const out: Record<string, { n: number; avg: number }> = {};
  for (const [k, vs] of Object.entries(buckets)) {
    out[k] = { n: vs.length, avg: +(vs.reduce((s, v) => s + v, 0) / vs.length).toFixed(2) };
  }
  return out;
}

const on = load(onPath);
const off = load(offPath);

console.log('# TM-46 r7 — RAG-ON vs RAG-OFF\n');
console.log(`Generated: ${new Date().toISOString()}\n`);

if (!on && !off) {
  console.log('No score files found. Aborting.');
  process.exit(0);
}

const onN = on?.n ?? 0;
const offN = off?.n ?? 0;
console.log(`## Summary\n`);
console.log(`| Mode | n | avg_overall | layout | typo | motion | fidelity |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|`);
if (on) {
  const a = avgAxis(on.results);
  console.log(`| RAG-ON | ${onN} | **${on.avg_overall}** | ${a.layout} | ${a.typography} | ${a.motion} | ${a.fidelity} |`);
}
if (off) {
  const a = avgAxis(off.results);
  console.log(`| RAG-OFF | ${offN} | **${off.avg_overall}** | ${a.layout} | ${a.typography} | ${a.motion} | ${a.fidelity} |`);
}
if (on && off) {
  const delta = +(on.avg_overall - off.avg_overall).toFixed(2);
  const sig = Math.abs(delta) >= 5 ? '**' : '';
  console.log(`\n**Δ (RAG-ON − RAG-OFF) = ${sig}${delta >= 0 ? '+' : ''}${delta}${sig} pts** (overall_score, 0-100 scale)\n`);
}

if (on) {
  console.log('\n## RAG-ON per-category\n');
  const cats = byCategory(on.results);
  console.log(`| category | n | avg |`); console.log(`|---|---:|---:|`);
  for (const [k, v] of Object.entries(cats)) console.log(`| ${k} | ${v.n} | ${v.avg} |`);
}
if (off) {
  console.log('\n## RAG-OFF per-category\n');
  const cats = byCategory(off.results);
  console.log(`| category | n | avg |`); console.log(`|---|---:|---:|`);
  for (const [k, v] of Object.entries(cats)) console.log(`| ${k} | ${v.n} | ${v.avg} |`);
}

if (on && off) {
  console.log('\n## Per-prompt comparison (intersection of IDs)\n');
  const offMap = new Map(off.results.map((r) => [r.id, r]));
  const rows: Array<{ id: string; category: string; on: number; off: number; delta: number }> = [];
  for (const o of on.results) {
    const f = offMap.get(o.id);
    if (!f) continue;
    rows.push({ id: o.id, category: o.category, on: o.overall_score, off: f.overall_score, delta: o.overall_score - f.overall_score });
  }
  rows.sort((a, b) => b.delta - a.delta);
  console.log(`| id | category | RAG-ON | RAG-OFF | Δ |`);
  console.log(`|---|---|---:|---:|---:|`);
  for (const r of rows) console.log(`| ${r.id} | ${r.category} | ${r.on} | ${r.off} | ${r.delta >= 0 ? '+' : ''}${r.delta} |`);
  const meanDelta = rows.length > 0 ? +(rows.reduce((s, r) => s + r.delta, 0) / rows.length).toFixed(2) : 0;
  const wins = rows.filter((r) => r.delta > 0).length;
  const losses = rows.filter((r) => r.delta < 0).length;
  const ties = rows.filter((r) => r.delta === 0).length;
  console.log(`\n**paired n=${rows.length}, meanΔ=${meanDelta}, wins(ON)=${wins}, losses(ON)=${losses}, ties=${ties}**\n`);
}

// ADR-0016 four criteria evaluation (per mode)
function adr0016(rs: PromptScore[], label: string): void {
  if (rs.length === 0) return;
  const scores = rs.map((r) => r.overall_score);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
  const std = Math.sqrt(variance);
  const ci95Half = 1.96 * std / Math.sqrt(scores.length);
  const cats = byCategory(rs);
  const minCat = Math.min(...Object.values(cats).map((c) => c.avg));
  console.log(`\n## ADR-0016 — ${label}\n`);
  console.log(`| # | criterion | threshold | actual | verdict |`);
  console.log(`|---|---|---|---:|---|`);
  console.log(`| C1 | mean ≥ 75 | 75 | ${mean.toFixed(2)} | ${mean >= 75 ? 'PASS' : '**FAIL**'} |`);
  console.log(`| C2 | std < 15 (single-run cross-prompt proxy) | 15 | ${std.toFixed(2)} | ${std < 15 ? 'PASS' : '**FAIL**'} |`);
  console.log(`| C3 | 95% CI ⊂ [70,80] | [70,80] | [${(mean - ci95Half).toFixed(2)}, ${(mean + ci95Half).toFixed(2)}] | ${mean - ci95Half >= 70 && mean + ci95Half <= 80 ? 'PASS' : '**FAIL**'} |`);
  console.log(`| C4 | per-category min ≥ 60 | 60 | ${minCat.toFixed(2)} | ${minCat >= 60 ? 'PASS' : '**FAIL**'} |`);
}
if (on) adr0016(on.results, 'RAG-ON');
if (off) adr0016(off.results, 'RAG-OFF');
