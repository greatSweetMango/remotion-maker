#!/usr/bin/env tsx
/**
 * TM-188 — motion-presence benchmark driver.
 *
 * Measures, per generated composition, whether the output actually MOVES across
 * frames, using the TM-184 liveness gate (AST pre-filter + render-diff). It
 * aggregates a motion-presence pass-rate and an average motion score so we can
 * compare a baseline (pre-fix) snapshot against an after (post-fix) snapshot.
 *
 * This is the deterministic measurement harness + driver skeleton. It runs in
 * two modes:
 *
 *   --mode=fixtures   (DEFAULT, fully deterministic, no key / no dev server)
 *     Classifies the bundled known-static / known-live / render-diff fixtures
 *     (scripts/bench/tm-188/fixtures.ts). Used to PROVE the driver labels motion
 *     presence correctly. CI / this session run this mode.
 *
 *   --mode=live       (requires OPENAI key + dev server; nightly keyed loop)
 *     Walks scripts/bench/tm-188/motion-corpus.json, calls /api/generate for
 *     each prompt, applies the SAME liveness scoring to the returned code, and
 *     records baseline/after rows. NOT run in this session (stall risk) — it is
 *     the spawned nightly task. The function is wired but guarded behind a live
 *     flag + reachable BASE_URL.
 *
 * Determinism (ADR-0018): the scoring path is pure arithmetic + AST regex; no
 * model call, no randomness, fixed ε, fixed downscale grid, fixed frames. The
 * corpus carries seed:42. The fixtures mode therefore produces byte-identical
 * output across runs.
 *
 * TM-184 contract respected: isLivenessRenderEnabled() defaults render OFF
 * under the test runner; this driver injects __renderStill/__extractFeatures
 * (mock seam) for the render-diff fixtures so it never boots a real renderer in
 * fixtures mode, and only uses real renders in --mode=live when a bundle path
 * is supplied.
 *
 * Usage:
 *   npx tsx scripts/bench/tm-188/motion-presence-bench.ts                 # fixtures
 *   npx tsx scripts/bench/tm-188/motion-presence-bench.ts --mode=fixtures
 *   BASE_URL=http://127.0.0.1:3088 npx tsx scripts/bench/tm-188/motion-presence-bench.ts --mode=live --label=baseline
 *
 * Conflict note (TM-186): this driver only consumes liveness-check.ts. It never
 * touches composition-critique.ts / the judge — TM-186's surface. When TM-186's
 * motion judge lands, its score is ADDITIVE (a new column), not a rewrite here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scoreMotion,
  aggregate,
  type BenchRow,
} from './scorer';
import {
  STATIC_SOURCE_FIXTURES,
  LIVE_SOURCE_FIXTURES,
  RENDER_FIXTURES,
  type SourceFixture,
  type RenderFixture,
} from './fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-188');
const CORPUS_PATH = path.join(__dirname, 'motion-corpus.json');

// Row type lives in scorer.ts (BenchRow); alias locally for brevity.
type Row = BenchRow;

// ---------------------------------------------------------------------------
// Mode: fixtures (deterministic self-verification)
// ---------------------------------------------------------------------------

async function runFixtures(): Promise<{ rows: Row[]; allCorrect: boolean }> {
  const rows: Row[] = [];

  const scoreSource = async (f: SourceFixture, source: Row['source']) => {
    const s = await scoreMotion(f.code);
    const isStatic = s.verdict === 'static';
    rows.push({
      id: f.id,
      source,
      expectStatic: f.expectStatic,
      verdict: s.verdict,
      stage: s.stage,
      astReasonCodes: s.astReasonCodes,
      motionScore: s.motionScore,
      classifiedCorrectly: isStatic === f.expectStatic,
      note: f.note,
    });
  };

  for (const f of STATIC_SOURCE_FIXTURES) await scoreSource(f, 'fixture-static');
  for (const f of LIVE_SOURCE_FIXTURES) await scoreSource(f, 'fixture-live');

  for (const f of RENDER_FIXTURES as RenderFixture[]) {
    // Render fixtures use a deliberately live-looking source so AST passes and
    // the render diff decides — that's the whole point of the stage.
    const liveLookingSource =
      'function GeneratedAsset(){ const f = useCurrentFrame(); return <div data-f={f}/>; }';
    const s = await scoreMotion(liveLookingSource, f.frames);
    const isStatic = s.verdict === 'static';
    rows.push({
      id: f.id,
      source: 'fixture-render',
      expectStatic: f.expectStatic,
      verdict: s.verdict,
      stage: s.stage,
      astReasonCodes: s.astReasonCodes,
      motionScore: s.motionScore,
      classifiedCorrectly: isStatic === f.expectStatic,
      note: f.note,
    });
  }

  const allCorrect = rows.every((r) => r.classifiedCorrectly === true);
  return { rows, allCorrect };
}

// ---------------------------------------------------------------------------
// Mode: live (nightly keyed loop — wired, NOT run in this session)
// ---------------------------------------------------------------------------

interface CorpusEntry {
  id: string;
  category: string;
  motionSubtype: string;
  pastStaticFailure: boolean;
  expectMotion: boolean;
  prompt: string;
}

function loadCorpus(): { name: string; prompts: CorpusEntry[] } {
  const raw = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
  return raw;
}

async function runLive(label: string): Promise<Row[]> {
  const BASE = process.env.BASE_URL;
  if (!BASE) {
    throw new Error(
      'live mode requires BASE_URL (a running dev server). Reserved for the nightly keyed loop.',
    );
  }
  const corpus = loadCorpus();
  const rows: Row[] = [];

  // Auth (dev auto-login) — mirrors tm-173 driver.
  const loginRes = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, {
    redirect: 'manual',
  });
  const setCookies =
    typeof loginRes.headers.getSetCookie === 'function' ? loginRes.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(';')[0].trim()).join('; ');

  for (const p of corpus.prompts) {
    const row: Row = {
      id: p.id,
      source: 'live-corpus',
      expectStatic: false,
      verdict: 'skipped',
      stage: 'none',
      astReasonCodes: [],
      motionScore: null,
      classifiedCorrectly: null,
      note: `${p.motionSubtype}${p.pastStaticFailure ? ' (past-static)' : ''}`,
      error: null,
    };
    try {
      // generate (clarify → answer-first → generate), mirroring tm-173.
      let res = await fetch(`${BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ prompt: p.prompt }),
      });
      let json: Record<string, unknown> | null = await res.json().catch(() => null);
      if (json?.type === 'clarify') {
        const answers: Record<string, string> = {};
        const questions = (json.questions ?? []) as Array<{
          id?: string;
          choices?: Array<{ id: string }>;
        }>;
        for (const q of questions) {
          if (q?.id && q.choices?.length) answers[q.id] = q.choices[0].id;
        }
        res = await fetch(`${BASE}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ prompt: p.prompt, answers }),
        });
        json = await res.json().catch(() => null);
      }
      const asset = json?.asset as { code?: string } | undefined;
      const code: string | undefined = asset?.code;
      if (!code) {
        row.error = `no code (type=${json?.type})`;
      } else {
        // AST-only score in live mode here; the render-diff axis is exercised by
        // the in-pipeline TM-184 gate. (Keeping the driver render-free avoids a
        // second heavy render pass.)
        const s = await scoreMotion(code);
        row.verdict = s.verdict;
        row.stage = s.stage;
        row.astReasonCodes = s.astReasonCodes;
        row.motionScore = s.motionScore;
      }
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    }
    rows.push(row);
    console.log(`[${label}][${row.id}] verdict=${row.verdict} stage=${row.stage} ${row.error ?? ''}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

async function main() {
  const mode = arg('mode', 'fixtures') as string;
  const label = (arg('label', mode === 'live' ? 'baseline' : 'fixtures') ?? 'fixtures') as string;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const startedAt = new Date().toISOString();
  let rows: Row[];
  let allCorrect: boolean | null = null;

  if (mode === 'fixtures') {
    const out = await runFixtures();
    rows = out.rows;
    allCorrect = out.allCorrect;
  } else if (mode === 'live') {
    rows = await runLive(label);
  } else {
    throw new Error(`unknown --mode=${mode} (expected fixtures|live)`);
  }

  const summary = {
    task: 'TM-188',
    mode,
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    seed: 42,
    deterministic: mode === 'fixtures',
    corpus: path.relative(ROOT, CORPUS_PATH),
    aggregate: aggregate(rows),
    fixtures_all_classified_correctly: allCorrect,
    rows,
  };

  const outFile = path.join(OUT_DIR, `${mode}-${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log('\n=== TM-188 motion-presence bench ===');
  console.log(`mode=${mode} label=${label}`);
  console.log(JSON.stringify(summary.aggregate, null, 2));
  if (mode === 'fixtures') {
    console.log(`fixtures classified correctly: ${allCorrect ? 'ALL ✓' : 'MISMATCH ✗'}`);
    const wrong = rows.filter((r) => r.classifiedCorrectly === false);
    if (wrong.length) {
      console.error('MISCLASSIFIED:', wrong.map((r) => `${r.id} (got ${r.verdict})`).join(', '));
    }
  }
  console.log(`→ ${path.relative(ROOT, outFile)}`);

  // Non-zero exit on fixture misclassification so CI fails loudly.
  if (mode === 'fixtures' && allCorrect !== true) process.exit(1);
}

main().catch((err) => {
  console.error('TM-188 bench failed:', err);
  process.exit(1);
});
