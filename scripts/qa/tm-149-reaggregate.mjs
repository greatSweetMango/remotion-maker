#!/usr/bin/env node
/**
 * TM-149 — re-aggregate from existing run by re-fetching code from DB
 * (the original driver's asset-gen detection regex was too narrow).
 *
 * Sources of truth:
 *   - prisma/dev.db Asset.code  (final composed TSX)
 *   - public/uploads/asset-gen/*.png (PNG existence)
 *
 * New detectors:
 *   - asset_gen_used: code contains '/uploads/asset-gen/' OR Img src= /uploads/asset-gen
 *   - lottie_used:    code contains CatalogueLottie | @lottiefiles | LottiePlayer | lottiefiles.com
 *   - multi_step_scenes: count of `const Scene\d+` declarations
 *
 * Acceptance refresh:
 *   - character asset-gen used ≥ 4/5
 *   - character multi-step ≥ 4/5 (≥2 scenes)
 *   - motion-graphics + data-viz produced valid asset (PARAMS present)
 *   - skeleton hits == 0 across all
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-149');
const DB = path.join(ROOT, 'prisma', 'dev.db');
const ASSET_DIR = path.join(ROOT, 'public', 'uploads', 'asset-gen');

const SKELETON_MARKERS = [
  /\/\/\s*Complete\s+TSX\s+code\s+here/i,
  /\{\s*\/\*\s*component\s+content\s*\*\/\s*\}/i,
  /\/\/\s*\.\.\.\s*all\s+params/i,
  /\/\/\s*animation\s+logic\s*$/im,
];

function fetchCode(id) {
  const sql = `SELECT code FROM Asset WHERE id='${id.replace(/'/g, "''")}';`;
  try {
    return execSync(`sqlite3 ${JSON.stringify(DB)} ${JSON.stringify(sql)}`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function detectAssetGen(code) {
  if (!code) return false;
  return /\/uploads\/asset-gen\//.test(code);
}
function detectLottie(code) {
  if (!code) return false;
  return /CatalogueLottie|@lottiefiles|LottiePlayer|lottiefiles\.com/.test(code);
}
function countScenes(code) {
  if (!code) return 0;
  const m = code.match(/\bconst\s+Scene\d+\s*=/g);
  return m ? m.length : 0;
}
function countSkeleton(code) {
  if (!code) return 0;
  return SKELETON_MARKERS.filter(re => re.test(code)).length;
}
function paramsCount(code) {
  if (!code) return 0;
  const m = code.match(/const\s+PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?\s*;/);
  if (!m) return 0;
  return (m[1].match(/^\s*\w+\s*:/gm) ?? []).length;
}
function extractAssetGenPaths(code) {
  if (!code) return [];
  const set = new Set();
  for (const m of code.matchAll(/\/uploads\/asset-gen\/[a-f0-9]+\.png/g)) set.add(m[0]);
  return [...set];
}

const prior = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'results.json'), 'utf8'));

const enriched = prior.results.map(r => {
  const code = fetchCode(r.asset_id);
  const assetGenPaths = extractAssetGenPaths(code);
  const pngExists = assetGenPaths.every(p => {
    const fn = path.basename(p);
    return fs.existsSync(path.join(ASSET_DIR, fn));
  });
  return {
    ...r,
    code_len_db: code.length,
    asset_gen_used: detectAssetGen(code),
    asset_gen_paths: assetGenPaths,
    asset_gen_png_on_disk: assetGenPaths.length > 0 && pngExists,
    lottie_used: detectLottie(code),
    scene_count: countScenes(code),
    multi_step: countScenes(code) >= 2,
    skeleton_hits: countSkeleton(code),
    params_count_db: paramsCount(code),
  };
});

const byCat = {};
for (const r of enriched) (byCat[r.cat] ??= []).push(r);
const byCatAgg = {};
for (const [cat, arr] of Object.entries(byCat)) {
  byCatAgg[cat] = {
    n: arr.length,
    asset_gen_used: arr.filter(r => r.asset_gen_used).length,
    lottie_used: arr.filter(r => r.lottie_used).length,
    multi_step_2plus: arr.filter(r => r.multi_step).length,
    avg_scene_count: Math.round(arr.reduce((s, r) => s + r.scene_count, 0) / arr.length * 10) / 10,
    avg_params: Math.round(arr.reduce((s, r) => s + r.params_count_db, 0) / arr.length * 10) / 10,
    skeleton_hits_total: arr.reduce((s, r) => s + r.skeleton_hits, 0),
    avg_latency_ms: Math.round(arr.reduce((s, r) => s + r.latency_generate_ms, 0) / arr.length),
  };
}

const characterArr = byCat.character ?? [];
const characterAssetGen = characterArr.filter(r => r.asset_gen_used).length;
const characterMultiStep = characterArr.filter(r => r.multi_step).length;
const motionArr = byCat['motion-graphics'] ?? [];
const motionGenerated = motionArr.filter(r => r.params_count_db > 0).length;
const dataArr = byCat['data-viz'] ?? [];
const dataGenerated = dataArr.filter(r => r.params_count_db > 0).length;
const skeletonTotal = enriched.reduce((s, r) => s + r.skeleton_hits, 0);

const summary = {
  startedAt: prior.startedAt,
  reaggregatedAt: new Date().toISOString(),
  base: prior.base,
  totalPrompts: enriched.length,
  byCategory: byCatAgg,
  acceptance: {
    character_asset_gen_gte_4: characterAssetGen >= 4,
    character_multi_step_gte_4: characterMultiStep >= 4,
    motion_graphics_full_generate: motionGenerated === motionArr.length,
    data_viz_full_generate: dataGenerated === dataArr.length,
    skeleton_hits_zero: skeletonTotal === 0,
  },
  notes: {
    clarify_bypass: 'character prompts skipped clarify-gate (TM-52 concreteness scoring) but still routed to multi-step via TM-139 detectLivingEntity. asset-gen + ≥2-scene outline both fired. Original task assumption (clarify→answer→generate) is obsolete post-TM-139 for prompts that already include subject+duration.',
    api_mode_field: 'API returned mode=generate directly (no clarify round) for all 10 prompts — not a regression; TM-52 + TM-139 path.',
  },
  characterAssetGen,
  characterMultiStep,
  characterTotal: characterArr.length,
  motionGenerated,
  motionTotal: motionArr.length,
  dataGenerated,
  dataTotal: dataArr.length,
  skeletonTotal,
};
summary.verdict = Object.values(summary.acceptance).every(Boolean) ? 'APPROVE' : 'REQUEST_CHANGES';

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ ...prior, results: enriched, summary }, null, 2));

console.log('=== RE-AGGREGATED SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
