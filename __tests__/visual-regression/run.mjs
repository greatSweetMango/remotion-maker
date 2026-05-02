#!/usr/bin/env node
// TM-75 visual-regression driver.
//
// Modes:
//   --update     Capture/refresh baseline PNGs + meta.json.
//   (default)    Render current frames + diff against baselines.
//                Exits with code 1 if any template breaches the threshold.
//   --only=<id>  Restrict to a single template id (debugging).
//
// Strategy:
//   1. Read all 35 templates from src/lib/templates.ts (id+filename+fps).
//   2. Bundle src/remotion/UniversalComposition.tsx once (~5s).
//   3. For each template: transpile .tsx -> jsCode (sucrase, same path as
//      the in-app loader uses), then renderStill at frame=Math.round(fps)
//      i.e. the 1-second mark. Image format: PNG.
//   4. Compute sha256 + dHash + (in compare mode) pixelDiff against the
//      baseline. PASS if pixelDiff.ratio < 0.05 (5%).
//   5. Persist baselines to __tests__/visual-regression/baselines/<id>.png
//      with a meta.json sidecar documenting hashes + dims + capture frame.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { transform } from 'sucrase';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import { TEMPLATES } from './registry.mjs';
import { sha256, dHash, hammingDistance, pixelDiff, HASH_BITS } from './phash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TEMPLATES_DIR = path.join(ROOT, 'src/remotion/templates');
// Dedicated entry that calls registerRoot() — see vr-entry.tsx for rationale.
const ENTRY = path.join(HERE, 'vr-entry.tsx');
const COMPOSITION_ID = 'VRComposition';
const BASELINES = path.join(HERE, 'baselines');
const META_PATH = path.join(BASELINES, 'meta.json');

// Threshold: max fraction of changed pixels (downscaled grayscale) for PASS.
const DIFF_THRESHOLD = 0.05;
// Hamming-distance budget for the dHash channel (out of 64 bits). A handful
// of bits flipping is normal jitter; >12 means the perceptual structure shifted.
const HAMMING_THRESHOLD = 12;

const args = new Set(process.argv.slice(2));
const isUpdate = args.has('--update');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyId = onlyArg ? onlyArg.slice('--only='.length) : null;

function log(...m) { console.log('[vr]', ...m); }
function warn(...m) { console.warn('[vr]', ...m); }
function err(...m) { console.error('[vr]', ...m); }

/**
 * Mirror src/lib/remotion/sandbox.ts::sanitizeCode. Applied BEFORE transpile,
 * exactly as the in-app loader does (src/lib/templates.ts:loadTemplate). The
 * evaluator's `new Function(...)` body can't accept `import` statements, so
 * we strip the well-known ones (remotion / react / lucide-react) and rewrite
 * default-export / named-export forms into plain `const` declarations.
 *
 * Kept inline (not imported from sandbox.ts) so this driver can stay a pure
 * .mjs file with no TypeScript pipeline. If sandbox.ts changes, mirror it
 * here.
 */
function sanitizeCode(code) {
  return code
    .replace(/^import\s+.*?from\s+['"]remotion['"];?\s*$/gm, '')
    .replace(/^import\s+.*?from\s+['"]react['"];?\s*$/gm, '')
    .replace(/^import\s+.*?from\s+['"]lucide-react['"];?\s*$/gm, '')
    .replace(/^import\s+type\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const DefaultExport = ')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ')
    .trim();
}

/**
 * Transpile a template .tsx to the same jsCode shape the in-app loader emits
 * (see src/lib/remotion/transpiler.ts). Kept literally identical so baselines
 * match what users would see in the app.
 */
function transpileTSX(code) {
  return transform(code, {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'classic',
    production: true,
  }).code;
}

async function loadTemplateJsCode(file) {
  const tsx = await readFile(path.join(TEMPLATES_DIR, file), 'utf-8');
  return transpileTSX(sanitizeCode(tsx));
}

async function main() {
  const targets = onlyId ? TEMPLATES.filter((t) => t.id === onlyId) : TEMPLATES;
  if (targets.length === 0) {
    err(`no templates matched --only=${onlyId}`);
    process.exit(2);
  }

  log(`mode=${isUpdate ? 'update-baselines' : 'compare'} templates=${targets.length}`);
  await mkdir(BASELINES, { recursive: true });

  // Load existing meta (compare mode requires it; update mode rebuilds it).
  let prevMeta = {};
  if (existsSync(META_PATH)) {
    try {
      prevMeta = JSON.parse(await readFile(META_PATH, 'utf-8'));
    } catch (e) {
      warn(`meta.json unreadable, treating as empty: ${e.message}`);
    }
  }

  log('bundling UniversalComposition (one-shot)…');
  const t0 = Date.now();
  // UniversalComposition.tsx exports `RemotionRoot` rather than calling
  // registerRoot() (it's also imported by the in-app server-side render path
  // in src/app/api/export/route.ts, which works the same way). The
  // ignoreRegisterRootWarning flag tells @remotion/bundler we know what we're
  // doing.
  // Inject the `@/*` alias the way next.js / tsconfig.json does so the
  // entry's `import { evaluateComponent } from '@/lib/remotion/evaluator'`
  // resolves under the standalone bundler (Next runtime isn't in the loop).
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias || {}),
          '@': path.join(ROOT, 'src'),
        },
      },
    }),
    ignoreRegisterRootWarning: true,
  });
  log(`bundle ready in ${Date.now() - t0}ms → ${serveUrl}`);

  const newMeta = isUpdate
    ? { generatedAt: new Date().toISOString(), threshold: DIFF_THRESHOLD, templates: {} }
    : { ...prevMeta, templates: { ...(prevMeta.templates || {}) } };

  const failures = [];
  const tmpDir = await mkdir(path.join(os.tmpdir(), `tm75-vr-${process.pid}`), { recursive: true });

  for (const t of targets) {
    const captureFrame = Math.min(Math.round(t.fps), Math.max(0, t.durationInFrames - 1));
    const t1 = Date.now();
    let jsCode;
    try {
      jsCode = await loadTemplateJsCode(t.file);
    } catch (e) {
      err(`[${t.id}] transpile failed: ${e.message}`);
      failures.push({ id: t.id, kind: 'transpile', detail: e.message });
      continue;
    }

    const inputProps = { jsCode, params: {} };
    let composition;
    try {
      composition = await selectComposition({
        serveUrl,
        id: COMPOSITION_ID,
        inputProps,
      });
    } catch (e) {
      err(`[${t.id}] selectComposition failed: ${e.message}`);
      failures.push({ id: t.id, kind: 'select', detail: e.message });
      continue;
    }

    const outPath = isUpdate
      ? path.join(BASELINES, `${t.id}.png`)
      : path.join(os.tmpdir(), `tm75-vr-${t.id}.png`);

    try {
      await renderStill({
        composition: { ...composition, durationInFrames: Math.max(composition.durationInFrames, captureFrame + 1) },
        serveUrl,
        output: outPath,
        inputProps,
        frame: captureFrame,
        imageFormat: 'png',
        overwrite: true,
      });
    } catch (e) {
      err(`[${t.id}] renderStill failed: ${e.message}`);
      failures.push({ id: t.id, kind: 'render', detail: e.message });
      continue;
    }

    const png = await readFile(outPath);
    const hashHex = sha256(png);
    const dh = await dHash(png);

    if (isUpdate) {
      newMeta.templates[t.id] = {
        file: t.file,
        captureFrame,
        fps: t.fps,
        width: t.width,
        height: t.height,
        sha256: hashHex,
        dHash: dh,
        bytes: png.length,
      };
      log(`[${t.id}] baseline @frame=${captureFrame} ${(png.length / 1024).toFixed(1)}KiB sha=${hashHex.slice(0, 12)} dh=${dh} (${Date.now() - t1}ms)`);
    } else {
      const baselinePath = path.join(BASELINES, `${t.id}.png`);
      const baselineMeta = (prevMeta.templates || {})[t.id];
      if (!existsSync(baselinePath) || !baselineMeta) {
        err(`[${t.id}] no baseline — run with --update first`);
        failures.push({ id: t.id, kind: 'missing-baseline' });
        continue;
      }
      const baselinePng = await readFile(baselinePath);
      const diff = await pixelDiff(baselinePng, png);
      const hd = hammingDistance(baselineMeta.dHash, dh);
      const exact = baselineMeta.sha256 === hashHex;
      const status =
        exact ? 'EXACT'
        : (diff.ratio < DIFF_THRESHOLD && hd <= HAMMING_THRESHOLD) ? 'PASS'
        : 'FAIL';
      log(`[${t.id}] ${status} sha-match=${exact} diff=${(diff.ratio * 100).toFixed(2)}% hamming=${hd}/${HASH_BITS} (${Date.now() - t1}ms)`);
      if (status === 'FAIL') {
        failures.push({
          id: t.id,
          kind: 'visual-drift',
          diffRatio: diff.ratio,
          hamming: hd,
          baselineSha: baselineMeta.sha256,
          currentSha: hashHex,
        });
        // Persist current frame next to the baseline for human inspection.
        const failOut = path.join(BASELINES, `${t.id}.current.png`);
        await writeFile(failOut, png);
        warn(`  -> wrote current to ${path.relative(ROOT, failOut)}`);
      } else {
        // Cleanup any stale .current.png from a prior failure.
        const stale = path.join(BASELINES, `${t.id}.current.png`);
        if (existsSync(stale)) await rm(stale).catch(() => {});
      }
    }
  }

  if (isUpdate) {
    await writeFile(META_PATH, JSON.stringify(newMeta, null, 2) + '\n');
    log(`wrote meta → ${path.relative(ROOT, META_PATH)}`);
  }

  if (failures.length) {
    err(`FAILURES: ${failures.length}/${targets.length}`);
    for (const f of failures) err(' -', JSON.stringify(f));
    process.exit(1);
  }
  log(`OK: ${targets.length}/${targets.length} ${isUpdate ? 'baseline(s) updated' : 'template(s) match baseline'}`);
}

main().catch((e) => {
  err('fatal:', e?.stack || e);
  process.exit(2);
});
