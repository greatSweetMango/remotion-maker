/**
 * TM-71 — visual-quality prompt-level pass: lightweight validation.
 *
 * Re-runs generation on the 5 worst-scoring prompts from TM-46 r3
 * (dv-02, dv-03, dv-08, tr-02, tr-08) using the updated
 * GENERATION_SYSTEM_PROMPT, and emits a static heuristic report:
 *   - code length (placeholder detector)
 *   - PARAMS presence and field count
 *   - JSX element count
 *   - presence of expected category motifs (e.g. an axis label for data-viz,
 *     two color states for a transition).
 *
 * This is NOT the gpt-4o multimodal judge from TM-46 — it's a $0.05
 * sanity gate to confirm the prompt change moves the generation in the
 * right direction without re-renting the full screenshot+judge pipeline.
 *
 * Usage:
 *   set -a; source .env.local; set +a;
 *   npx tsx __tests__/benchmarks/tm-71-validate.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateAsset } from '../../src/lib/ai/generate';
import { BENCHMARK_PROMPTS } from './params-extraction.benchmark';

const TARGET_IDS = ['dv-02', 'dv-03', 'dv-08', 'tr-02', 'tr-08'];

interface CaseReport {
  id: string;
  category: string;
  prompt: string;
  ok: boolean;
  codeLen: number;
  paramCount: number;
  jsxTags: number;
  motifs: Record<string, boolean>;
  title?: string;
  code?: string;
  error?: string;
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

function scoreCase(category: string, code: string): Record<string, boolean> {
  if (category === 'data-viz') {
    return {
      // bars/slices/segments rendered as separate JSX
      multipleElements:
        countMatches(code, /<rect|<path|<circle|<div[^>]*style/g) >= 4,
      // axes / labels / values
      hasLabels: /<text|fontSize|fontFamily|label/i.test(code),
      // animation primitive used
      usesInterpolate: /interpolate\s*\(|spring\s*\(/.test(code),
    };
  }
  if (category === 'transition') {
    return {
      // two distinct colors/states defined
      twoStates:
        countMatches(code, /#[0-9a-fA-F]{3,8}|hsl\(|rgb\(/g) >= 2 ||
        /backgroundColor.*backgroundColor/s.test(code),
      // interpolation-driven boundary
      usesInterpolate: /interpolate\s*\(|spring\s*\(/.test(code),
      // explicit transition technique present
      hasTechnique:
        /clipPath|clip-path|translate|opacity|mask|filter/i.test(code),
    };
  }
  return {};
}

async function main() {
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('Need OPENAI_API_KEY or ANTHROPIC_API_KEY in env');
  }

  const cases = TARGET_IDS.map((id) => {
    const p = BENCHMARK_PROMPTS.find((b) => b.id === id);
    if (!p) throw new Error(`prompt ${id} missing`);
    return p;
  });

  const reports: CaseReport[] = [];
  for (const c of cases) {
    const startedAt = Date.now();
    process.stdout.write(`[tm-71] ${c.id} (${c.category}) ... `);
    try {
      const res = (await generateAsset(c.prompt)) as unknown as {
        type?: string;
        asset?: { code: string; title: string };
        kind?: string;
        value?: { type: string; asset: { code: string; title: string } };
      };
      // generateAsset returns either GenerateApiResponse (top-level type=generate)
      // or a wrapped { kind, value }. Handle both shapes.
      const wrapped = res.kind === 'response' && res.value;
      const inner = wrapped ? res.value! : (res as unknown as { type: string; asset: { code: string; title: string } });
      if (inner.type !== 'generate' || !inner.asset) {
        throw new Error(`non-generate response: ${JSON.stringify(res).slice(0, 200)}`);
      }
      const asset = inner.asset;
      const code = asset.code;
      const paramCount = (
        code.match(/^\s{2}[a-zA-Z_][a-zA-Z0-9_]*\s*[:=]/gm) ?? []
      ).length;
      const jsxTags = countMatches(code, /<[A-Za-z][^/>]*>/g);
      const r: CaseReport = {
        id: c.id,
        category: c.category,
        prompt: c.prompt,
        ok: true,
        codeLen: code.length,
        paramCount,
        jsxTags,
        motifs: scoreCase(c.category, code),
        title: asset.title,
        code,
      };
      reports.push(r);
      const ms = Date.now() - startedAt;
      console.log(
        `OK ${code.length}ch params=${paramCount} jsx=${jsxTags} ${ms}ms`,
      );
    } catch (e) {
      const r: CaseReport = {
        id: c.id,
        category: c.category,
        prompt: c.prompt,
        ok: false,
        codeLen: 0,
        paramCount: 0,
        jsxTags: 0,
        motifs: {},
        error: e instanceof Error ? e.message : String(e),
      };
      reports.push(r);
      console.log(`FAIL ${r.error}`);
    }
  }

  const outDir = path.join(__dirname, 'results', 'tm-71');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'validate.json');
  fs.writeFileSync(outPath, JSON.stringify(reports, null, 2));
  console.log(`\n[tm-71] wrote ${outPath}`);

  const codeDir = path.join(outDir, 'code');
  fs.mkdirSync(codeDir, { recursive: true });
  for (const r of reports) {
    if (!r.ok || !r.code) continue;
    fs.writeFileSync(path.join(codeDir, `${r.id}.tsx`), r.code);
  }

  // Summary
  const ok = reports.filter((r) => r.ok);
  console.log(`\nSummary:  ${ok.length}/${reports.length} generated`);
  for (const r of reports) {
    if (!r.ok) {
      console.log(`  ${r.id}: FAIL ${r.error}`);
      continue;
    }
    const motifSummary = Object.entries(r.motifs)
      .map(([k, v]) => `${k}=${v ? 'Y' : 'N'}`)
      .join(' ');
    console.log(
      `  ${r.id} [${r.category}]: ${r.codeLen}ch params=${r.paramCount} jsx=${r.jsxTags} | ${motifSummary}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
