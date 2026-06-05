#!/usr/bin/env node
/**
 * TM-186 — motion-critique false-positive (FP) measurement harness.
 *
 * Joins the append-only motion-critique telemetry ledger
 * (`.agent-state/motion-fp-ledger.jsonl`, written by the live generate path)
 * with a golden label file and reports the false-positive rate against the
 * ADR-0016/TM-186 default-on gate (FP < 5%).
 *
 * A "false positive" = motion-critique flagged the composition BAD
 * (`categoryFloorViolated: true`) when the human label says the motion is
 * actually acceptable (`labelGood: true`).
 *
 * This is the OFFLINE half of the default-on flip. Running it needs a real
 * OPENAI_API_KEY + dev server to populate the ledger first (live measurement is
 * the spawned follow-up); this harness computes the rate once data exists and
 * is fully exercised by unit tests against `computeMotionFpRate`.
 *
 * Usage:
 *   node scripts/qa/tm-186-motion-fp.mjs \
 *     --ledger .agent-state/motion-fp-ledger.jsonl \
 *     --labels __tests__/benchmarks/results/tm-186/labels.json
 *
 * labels.json shape: { "<sampleId>": { "labelGood": true|false }, ... }
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const FP_GATE = 0.05;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ledgerPath = path.resolve(
  arg('ledger', path.join('.agent-state', 'motion-fp-ledger.jsonl')),
);
const labelsPath = arg('labels', null);

if (!existsSync(ledgerPath)) {
  console.error(`[tm-186-fp] ledger not found: ${ledgerPath}`);
  console.error('  Run the live generate path with AI_MOTION_CRITIQUE=1 + AI_MOTION_FP_PERSIST=1 first.');
  process.exit(2);
}

const records = readFileSync(ledgerPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter(Boolean);

let labels = {};
if (labelsPath && existsSync(labelsPath)) {
  labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
}

const labeled = records
  .filter((r) => labels[r.sampleId] !== undefined)
  .map((r) => ({
    categoryFloorViolated: !!r.categoryFloorViolated,
    labelGood: !!labels[r.sampleId].labelGood,
  }));

const total = labeled.length;
const falsePositives = labeled.filter((r) => r.categoryFloorViolated && r.labelGood).length;
const fpRate = total === 0 ? 0 : falsePositives / total;
const clearsGate = total > 0 && fpRate < FP_GATE;

// Variance-band audit: how many records had std above the ADR-0018 noise band.
const noisy = records.filter((r) => typeof r.std === 'number' && r.std > 5).length;

console.log('=== TM-186 motion-critique FP report ===');
console.log(`ledger records        : ${records.length}`);
console.log(`labeled (joined)      : ${total}`);
console.log(`false positives       : ${falsePositives}`);
console.log(`FP rate               : ${(fpRate * 100).toFixed(2)}%  (gate < ${FP_GATE * 100}%)`);
console.log(`high-variance (std>5) : ${noisy}  (ADR-0018 noise-band audit)`);
console.log(`clears default-on gate: ${clearsGate ? 'YES' : 'NO'}`);

if (total === 0) {
  console.error('[tm-186-fp] no labeled records — cannot decide. Provide --labels.');
  process.exit(3);
}
process.exit(clearsGate ? 0 : 1);
