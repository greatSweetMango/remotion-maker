/**
 * TM-46 r6 — N=2 deterministic-pipeline analysis.
 *
 * Reads scores-r6a.json + scores-r6b.json and emits ADR-0016 4-criteria gate eval:
 *   1. mean ≥ 75
 *   2. std < 5  (between rounds A vs B)
 *   3. 95% CI ⊂ [70, 80]
 *   4. per-category min ≥ 60
 *
 * Also: r5 vs r6 std reduction comparison.
 */
import * as fs from 'fs';
import * as path from 'path';

interface PromptScore {
  id: string;
  category: string;
  prompt: string;
  overall_score: number;
  needs_followup: boolean;
}
interface ScoresFile {
  ran_at: string;
  n: number;
  avg_overall: number;
  followup_count: number;
  results: PromptScore[];
}

const ROOT = path.join(__dirname, 'results', 'tm-46');
const A_PATH = path.join(ROOT, 'scores-r6a.json');
const B_PATH = path.join(ROOT, 'scores-r6b.json');

const R5_OVERALL = 67.8;
const R5_MEAN_STD = 8.10;
const R5_MAX_STD = 34.50;
// r5 per-category avg from 2026-04-27-TM-46-visual-judge-r5.md
const R5_CAT: Record<string, number> = {
  'data-viz': 59.8,
  'text-anim': 75.2,
  'transition': 56.2,
  'loader': 79.2,
  'infographic': 68.5,
};

function load(p: string): ScoresFile {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function stdSample(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function main() {
  const A = load(A_PATH);
  const B = load(B_PATH);

  const byId = new Map<string, { a?: PromptScore; b?: PromptScore }>();
  for (const r of A.results) byId.set(r.id, { ...byId.get(r.id), a: r });
  for (const r of B.results) byId.set(r.id, { ...byId.get(r.id), b: r });

  const rows: Array<{
    id: string;
    category: string;
    a: number | null;
    b: number | null;
    avg: number | null;
    std: number;
  }> = [];
  for (const [id, { a, b }] of byId) {
    const aS = a?.overall_score ?? null;
    const bS = b?.overall_score ?? null;
    const both = [aS, bS].filter((x): x is number => x !== null);
    const avg = both.length ? both.reduce((s, x) => s + x, 0) / both.length : null;
    rows.push({
      id,
      category: a?.category ?? b?.category ?? '?',
      a: aS,
      b: bS,
      avg,
      std: stdSample(both),
    });
  }
  rows.sort((x, y) => x.id.localeCompare(y.id));

  const valid = rows.filter((r) => r.avg !== null);

  console.log('\n## TM-46 r6 — Per-prompt scores (A / B / avg / std)\n');
  console.log('| ID | category | A | B | avg | std |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.id} | ${r.category} | ${r.a ?? 'n/a'} | ${r.b ?? 'n/a'} | ${r.avg !== null ? r.avg.toFixed(1) : 'n/a'} | ${r.std.toFixed(2)} |`,
    );
  }

  // Per-round means
  const meanA = A.avg_overall;
  const meanB = B.avg_overall;
  // Round-level mean & std (treat each round's overall avg as one observation)
  const roundMeans = [meanA, meanB];
  const meanOfRounds = (meanA + meanB) / 2;
  const stdOfRounds = stdSample(roundMeans);

  // Aggregate per-prompt avg-of-avg
  const overallAvg = valid.reduce((s, r) => s + (r.avg ?? 0), 0) / valid.length;
  const stds = valid.map((r) => r.std);
  const meanStd = stds.reduce((a, b) => a + b, 0) / stds.length;
  const maxStd = Math.max(...stds);

  // Per-category
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    if (r.avg === null) continue;
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r.avg);
  }
  const catAvgs: Record<string, number> = {};
  console.log('\n## Per-category (r6 avg)\n');
  console.log('| category | n | avg | min | max | r5 avg | Δ |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [c, xs] of byCat) {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    catAvgs[c] = m;
    const r5 = R5_CAT[c];
    const delta = r5 !== undefined ? m - r5 : NaN;
    console.log(
      `| ${c} | ${xs.length} | ${m.toFixed(1)} | ${Math.min(...xs).toFixed(0)} | ${Math.max(...xs).toFixed(0)} | ${r5 ?? '—'} | ${isNaN(delta) ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(1)} |`,
    );
  }

  // ADR-0016 4-criteria evaluation (N=2 adapted; ADR uses N=3 windows; we report what we have)
  // For 95% CI use std/sqrt(n). With N=2 rounds, CI is wide but we still report.
  const n = roundMeans.length;
  const ci95Low = meanOfRounds - 1.96 * (stdOfRounds / Math.sqrt(n));
  const ci95High = meanOfRounds + 1.96 * (stdOfRounds / Math.sqrt(n));
  const minCat = Math.min(...Object.values(catAvgs));

  const c1 = meanOfRounds >= 75;
  const c2 = stdOfRounds < 5;
  const c3 = ci95Low >= 70 && ci95High <= 80;
  const c4 = minCat >= 60;

  console.log('\n## ADR-0016 4-criteria gate (N=2 rounds)\n');
  console.log(`- C1 mean ≥ 75: **${c1 ? 'PASS' : 'FAIL'}** (mean = ${meanOfRounds.toFixed(2)})`);
  console.log(`- C2 std < 5: **${c2 ? 'PASS' : 'FAIL'}** (std = ${stdOfRounds.toFixed(2)})`);
  console.log(`- C3 95% CI ⊂ [70, 80]: **${c3 ? 'PASS' : 'FAIL'}** ([${ci95Low.toFixed(2)}, ${ci95High.toFixed(2)}])`);
  console.log(`- C4 per-category min ≥ 60: **${c4 ? 'PASS' : 'FAIL'}** (min = ${minCat.toFixed(2)})`);
  const allPass = c1 && c2 && c3 && c4;
  console.log(`\n**OVERALL ACCEPTANCE: ${allPass ? 'PASS ✅' : 'MISS ❌'}**`);

  console.log('\n## Headline');
  console.log(`- run-A: ${A.ran_at}, run-B: ${B.ran_at}`);
  console.log(`- run-A avg = ${meanA}, run-B avg = ${meanB}`);
  console.log(`- mean of rounds = ${meanOfRounds.toFixed(2)} (std of rounds = ${stdOfRounds.toFixed(2)})`);
  console.log(`- per-prompt avg-of-avg = ${overallAvg.toFixed(2)}`);
  console.log(`- per-prompt mean std = ${meanStd.toFixed(2)} (r5: ${R5_MEAN_STD})`);
  console.log(`- per-prompt max std = ${maxStd.toFixed(2)} (r5: ${R5_MAX_STD})`);
  console.log(`- r5 → r6 overall: ${R5_OVERALL} → ${overallAvg.toFixed(1)} (Δ=${(overallAvg - R5_OVERALL).toFixed(1)})`);
  console.log(`- r5 → r6 mean_std: ${R5_MEAN_STD} → ${meanStd.toFixed(2)} (Δ=${(meanStd - R5_MEAN_STD).toFixed(2)})`);

  // Save summary
  const outPath = path.join(ROOT, 'r6-summary.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ran_at_a: A.ran_at,
        ran_at_b: B.ran_at,
        n: valid.length,
        run_a_avg: meanA,
        run_b_avg: meanB,
        mean_of_rounds: Math.round(meanOfRounds * 100) / 100,
        std_of_rounds: Math.round(stdOfRounds * 100) / 100,
        per_prompt_avg: Math.round(overallAvg * 100) / 100,
        per_prompt_mean_std: Math.round(meanStd * 100) / 100,
        per_prompt_max_std: Math.round(maxStd * 100) / 100,
        category_avgs: catAvgs,
        ci95: [Math.round(ci95Low * 100) / 100, Math.round(ci95High * 100) / 100],
        adr0016: { c1_mean: c1, c2_std: c2, c3_ci: c3, c4_cat_min: c4, pass: allPass },
        r5_compare: { r5_overall: R5_OVERALL, r5_mean_std: R5_MEAN_STD, r5_max_std: R5_MAX_STD },
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);
}

main();
