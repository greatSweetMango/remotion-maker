/**
 * TM-46 r5 — N=2 determinism + r3 vs r5 comparison.
 *
 * Reads two judge runs (scores-r5a.json, scores-r5b.json) and emits:
 *   - per-prompt avg/std across 2 runs
 *   - category aggregate
 *   - r3 → r5 comparison with collapse cases (dv-01, dv-10, ig-01, tr-10)
 *   - acceptance verdict (avg ≥ 75)
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
const A_PATH = path.join(ROOT, 'scores-r5a.json');
const B_PATH = path.join(ROOT, 'scores-r5b.json');

// r3 baselines (from wiki/05-reports/2026-04-27-TM-46-visual-judge-r3.md / r4 comparison table).
const R3_SCORES: Record<string, number | null> = {
  'dv-01': null, // gen-fail in r3
  'dv-02': 15,
  'dv-03': 23,
  'dv-06': 80,
  'dv-08': 60,
  'dv-10': null, // gen-fail in r3
  'tr-01': 79,
  'tr-02': 43,
  'tr-03': 53,
  'tr-05': 68,
  'tr-08': 48,
  'tr-10': 90,
  'ig-01': 76,
};

const R3_OVERALL = 71.2;
const R4_OVERALL = 63.4;

function load(p: string): ScoresFile {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
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
    r3: number | null;
    deltaR3: number | null;
  }> = [];

  for (const [id, { a, b }] of byId) {
    const aS = a?.overall_score ?? null;
    const bS = b?.overall_score ?? null;
    const both = [aS, bS].filter((x): x is number => x !== null);
    const avg = both.length ? both.reduce((s, x) => s + x, 0) / both.length : null;
    const s = std(both);
    const r3 = R3_SCORES[id] ?? null;
    rows.push({
      id,
      category: a?.category ?? b?.category ?? '?',
      a: aS,
      b: bS,
      avg,
      std: s,
      r3,
      deltaR3: avg !== null && r3 !== null ? avg - r3 : null,
    });
  }

  rows.sort((x, y) => x.id.localeCompare(y.id));

  // Per-prompt table
  console.log('\n## Per-prompt scores (run-A / run-B / avg / std)\n');
  console.log('| ID | category | A | B | avg | std | r3 | Δr3 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.id} | ${r.category} | ${r.a ?? 'n/a'} | ${r.b ?? 'n/a'} | ${
        r.avg !== null ? r.avg.toFixed(1) : 'n/a'
      } | ${r.std.toFixed(2)} | ${r.r3 ?? '—'} | ${r.deltaR3 !== null ? (r.deltaR3 >= 0 ? '+' : '') + r.deltaR3.toFixed(1) : '—'} |`,
    );
  }

  // Per-category aggregate (avg of avg)
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    if (r.avg === null) continue;
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r.avg);
  }
  console.log('\n## Per-category (r5 avg)\n');
  console.log('| category | n | avg | min | max |');
  console.log('|---|---|---|---|---|');
  for (const [c, xs] of byCat) {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(
      `| ${c} | ${xs.length} | ${m.toFixed(1)} | ${Math.min(...xs).toFixed(0)} | ${Math.max(...xs).toFixed(0)} |`,
    );
  }

  const valid = rows.filter((r) => r.avg !== null);
  const overallAvg = valid.reduce((s, r) => s + (r.avg ?? 0), 0) / valid.length;
  const stds = valid.map((r) => r.std);
  const meanStd = stds.reduce((a, b) => a + b, 0) / stds.length;
  const maxStd = Math.max(...stds);

  console.log('\n## Headline');
  console.log(`- N=2 runs (run-A: ${A.ran_at}, run-B: ${B.ran_at})`);
  console.log(`- Valid prompts (both runs scored): ${valid.length}/${rows.length}`);
  console.log(`- r5 overall avg: **${overallAvg.toFixed(1)}** / 100`);
  console.log(`- r1 71.2 → r3 71.2 → r4 63.4 → **r5 ${overallAvg.toFixed(1)}**`);
  console.log(`- mean std (across 2 runs, deterministic judge): **${meanStd.toFixed(2)}**`);
  console.log(`- max std: ${maxStd.toFixed(2)} (target <3 for determinism)`);
  console.log(`- acceptance(>=75): ${overallAvg >= 75 ? '**PASS**' : '**MISS**'}`);

  // Highlight collapse cases
  console.log('\n## Collapse / recovery cases (r4 collapses)\n');
  for (const id of ['dv-01', 'dv-10', 'tr-10', 'ig-01', 'dv-02', 'dv-08']) {
    const r = rows.find((x) => x.id === id);
    if (!r) continue;
    console.log(
      `- ${id}: r3=${r.r3 ?? 'gen-fail'} → r5=${r.avg !== null ? r.avg.toFixed(1) : 'n/a'} (std=${r.std.toFixed(2)}) [A=${r.a ?? 'n/a'}, B=${r.b ?? 'n/a'}]`,
    );
  }

  // Save summary JSON
  const outPath = path.join(ROOT, 'r5-summary.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ran_at_a: A.ran_at,
        ran_at_b: B.ran_at,
        n: valid.length,
        overall_avg: Math.round(overallAvg * 10) / 10,
        mean_std: Math.round(meanStd * 100) / 100,
        max_std: Math.round(maxStd * 100) / 100,
        acceptance_pass: overallAvg >= 75,
        history: { r1: 71.2, r3: R3_OVERALL, r4: R4_OVERALL, r5: Math.round(overallAvg * 10) / 10 },
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);
}

main();
