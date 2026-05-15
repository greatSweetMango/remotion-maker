#!/usr/bin/env node
/**
 * TM-134 — Detect server-only modules leaking into the client bundle.
 *
 * Pattern this guards (TM-81, TM-133):
 *   - `src/lib/**` modules that import `node:*` or `'server-only'` (or
 *     transitively reach prisma) MUST NOT be reachable from any client
 *     entry point (a `'use client'` file, OR any `<route>/page.tsx` /
 *     `layout.tsx` that itself transitively imports a client component
 *     pulling the server module).
 *
 *   - We model this conservatively and AT THE MODULE LEVEL: if any module
 *     marked "server-tainted" is imported (transitively) by any module
 *     marked "client-reachable", we report a leak with the full chain.
 *
 * Why module-level (and not "client-only" graph)?
 *   Turbopack/webpack bundle the *whole module* on first import — so a
 *   `'use client'` component importing one symbol from a mixed module
 *   pulls the entire module's top-level imports into the client chunk.
 *   That's exactly the TM-81/TM-133 failure mode.
 *
 * Outputs (stderr) the import chain in TM-133 retro format:
 *   ./src/lib/audio/manifest.ts
 *     → ./src/remotion/CatalogueAudio.tsx
 *     → ./src/lib/remotion/evaluator.ts
 *     → ./src/components/gallery/TemplateCard.tsx
 *     → ./src/app/(marketing)/_LandingClient.tsx
 *
 * Exit codes:
 *   0  no leaks detected
 *   1  one or more leaks detected
 *   2  usage / IO error
 *
 * Usage:
 *   node scripts/ci/check-server-only-leaks.mjs                  # full repo
 *   node scripts/ci/check-server-only-leaks.mjs --json           # JSON out
 *   node scripts/ci/check-server-only-leaks.mjs --root <dir>     # alt root
 *
 * No new npm deps — pure stdlib. Module resolution is conservative:
 *   - resolves `@/foo` (tsconfig paths) → `<root>/src/foo`
 *   - resolves relative `./foo` `../foo` against the importer
 *   - tries extensions [.ts .tsx .js .jsx .mjs .cjs] and `/index.<ext>`
 *   - bare specifiers (npm pkgs) are ignored, EXCEPT the literal
 *     `'server-only'` (used as a taint marker)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const rootArgIdx = args.indexOf('--root');
const ROOT = rootArgIdx >= 0 ? resolve(args[rootArgIdx + 1]) : resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

// ---------- file walk ----------

/** @type {string[]} */
const allFiles = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (EXTS.some((ext) => e.name.endsWith(ext))) allFiles.push(full);
  }
}
if (!existsSync(SRC)) {
  console.error(`check-server-only-leaks: src not found at ${SRC}`);
  process.exit(2);
}
walk(SRC);

// ---------- resolve specifier → file ----------

function tryFile(p) {
  if (existsSync(p) && statSync(p).isFile()) return p;
  for (const ext of EXTS) {
    if (existsSync(p + ext)) return p + ext;
  }
  for (const ext of EXTS) {
    const idx = join(p, 'index' + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

function resolveSpec(spec, importerFile) {
  if (spec === 'server-only') return '__SERVER_ONLY_MARKER__';
  if (spec.startsWith('node:')) return '__NODE_BUILTIN__:' + spec.slice(5);
  if (spec.startsWith('@/')) {
    return tryFile(join(SRC, spec.slice(2)));
  }
  if (spec.startsWith('./') || spec.startsWith('../') || isAbsolute(spec)) {
    const base = isAbsolute(spec) ? spec : join(dirname(importerFile), spec);
    return tryFile(base);
  }
  // bare module — npm pkg, ignored (we only care about the prisma chain
  // through @/lib/db/prisma which is project code, not the @prisma/client
  // pkg directly; that import already lives in a tainted leaf file).
  return null;
}

// ---------- parse imports ----------

// Captures: import ... from '...';   import '...';   export ... from '...';
// Also captures dynamic import('...').
const STATIC_IMPORT_RE =
  /(?:^|\s)(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\s)import\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(src) {
  const out = new Set();
  for (const re of [STATIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
  }
  return [...out];
}

// ---------- classify each file ----------

/** @type {Map<string, { src: string, isClient: boolean, isServerAction: boolean, hasNodeImport: boolean, hasServerOnly: boolean, imports: string[] }>} */
const files = new Map();

for (const f of allFiles) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  // Strip block + line comments cheaply (avoid false positives on
  // 'use client' inside docs). Order matters: block first, then line.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

  // 'use client' directive must be at top of file (before any non-comment
  // statement). We approximate: among the first 5 non-empty lines, look
  // for a bare-string 'use client' or "use client".
  const headLines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 5);
  const isClient = headLines.some((l) => /^['"]use client['"];?$/.test(l));
  // `'use server'` at top of a *module* = Server Actions file. Client
  // imports of such a module become RPC stubs at build time — the
  // implementation never ships to the browser. So we treat it as a
  // graph TERMINATOR for client-bundle reachability (same as a
  // boundary). NB: route handlers (`route.ts` under app/api/**) are
  // also boundary stops by Next convention but we already won't reach
  // them via 'use client' imports.
  const isServerAction = headLines.some((l) => /^['"]use server['"];?$/.test(l));

  const imports = extractImports(stripped);
  const hasNodeImport = imports.some((s) => s.startsWith('node:'));
  const hasServerOnly = imports.includes('server-only');

  files.set(f, { src, isClient, isServerAction, hasNodeImport, hasServerOnly, imports });
}

// ---------- determine "tainted" set (server-only leaves) ----------

// A file is server-tainted iff it (a) imports 'server-only', or (b) imports
// any node:* builtin. We propagate taint UPWARD only when reporting a
// chain — the seeds are leaves with these imports.
const taintedSeeds = new Set();
for (const [f, info] of files) {
  if (info.hasServerOnly || info.hasNodeImport) {
    // Only seed files under src/lib/** OR src/app/api/** — but also, any
    // file with 'server-only' is a seed regardless of path.
    taintedSeeds.add(f);
  }
}

// ---------- determine "client-reachable" entry set ----------

// Seeds:
//   - Every file with a top-level `'use client'` directive.
//   - Every Next route file (page.tsx / layout.tsx / template.tsx /
//     loading.tsx / error.tsx / not-found.tsx) — these are reachable from
//     the browser shell. However route handlers (route.ts) are server-only
//     by Next convention, so they're NOT entries.
//   - middleware.ts / proxy.ts run on edge but are server; NOT entries.
//
// We over-approximate: for a route entry we treat it as "client-reachable"
// because it ships JS to the browser through Next's RSC boundary. Server
// components themselves are fine to import server-only modules — but the
// moment they import a `'use client'` component, that component's import
// graph IS the client bundle and any tainted module reachable through it
// leaks. So actually we don't need to seed page.tsx — only `'use client'`
// files matter for the "client bundle" sense. Keep it strict: client seeds
// are 'use client' files only.

const clientSeeds = new Set();
for (const [f, info] of files) {
  if (info.isClient) clientSeeds.add(f);
}

// ---------- build resolved import graph ----------

/** @type {Map<string, string[]>} */
const graph = new Map();
for (const [f, info] of files) {
  const resolved = [];
  for (const spec of info.imports) {
    const r = resolveSpec(spec, f);
    if (r && !r.startsWith('__')) resolved.push(r);
  }
  graph.set(f, resolved);
}

// Mark boundary nodes — graph traversal must NOT cross into them. A
// `'use server'` module is a boundary because client importers receive
// an RPC stub, not the module body. Server-only sentinel files are NOT
// boundaries (they're the leaves we want to report).
const boundaries = new Set();
for (const [f, info] of files) {
  if (info.isServerAction) boundaries.add(f);
}

// ---------- find leak chains ----------

// For each client seed, BFS the import graph; if a tainted seed is reached,
// record (clientSeed, taintedFile, chain).

/** @type {Array<{ tainted: string, chain: string[] }>} */
const leaks = [];
// Dedupe at the (tainted, firstHopFromClient) granularity. Multiple
// 'use client' seeds reaching the same tainted module via the same
// first-hop client component would otherwise spam the report with
// every parent in the client tree.
const seenLeakKey = new Set();

for (const start of clientSeeds) {
  // BFS with parent map
  const parent = new Map();
  parent.set(start, null);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (taintedSeeds.has(cur) && cur !== start) {
      // Reconstruct chain (start → ... → cur)
      const chain = [];
      let n = cur;
      while (n !== null) {
        chain.push(n);
        n = parent.get(n);
      }
      chain.reverse();
      // Key on (tainted, direct-importer-of-tainted). Multiple client
      // seeds in the tree above will all rediscover the same leaf
      // import; one report per direct importer is the actionable unit
      // (the developer changes that import line).
      const directImporter = chain[chain.length - 2] ?? chain[0];
      const key = `${cur}|${directImporter}`;
      if (!seenLeakKey.has(key)) {
        seenLeakKey.add(key);
        leaks.push({ tainted: cur, chain });
      }
      // Don't traverse further past a tainted node — its own deps don't
      // add new info for this seed.
      continue;
    }
    const next = graph.get(cur) || [];
    for (const n of next) {
      if (parent.has(n)) continue;
      // Don't traverse INTO a server-action boundary — its body never
      // ships to the client (RPC stub at runtime). The boundary itself
      // is recorded so we can show it in the chain if needed, but we
      // mark its further deps as "parent set" with a special tag so
      // BFS skips them. Simpler: just skip enqueueing the boundary
      // entirely UNLESS the boundary itself is tainted (in which case
      // it's still safe — the body is server-side).
      if (boundaries.has(n)) continue;
      parent.set(n, cur);
      queue.push(n);
    }
  }
}

// ---------- report ----------

function rel(p) {
  return './' + relative(ROOT, p);
}

if (jsonOut) {
  const out = leaks.map((l) => ({
    tainted: rel(l.tainted),
    chain: l.chain.map(rel),
  }));
  process.stdout.write(JSON.stringify({ leaks: out }, null, 2) + '\n');
} else {
  if (leaks.length === 0) {
    process.stdout.write(
      `check-server-only-leaks: OK — 0 server-only → client-bundle leaks ` +
        `(scanned ${files.size} files, ${clientSeeds.size} client seeds, ${taintedSeeds.size} tainted seeds)\n`,
    );
  } else {
    process.stderr.write(
      `check-server-only-leaks: FAIL — ${leaks.length} leak(s) detected ` +
        `(TM-81 / TM-133 pattern)\n\n`,
    );
    for (const l of leaks) {
      // Print chain in TM-133 retro format: tainted module on top, then
      // each importer below with leading "→ ".
      // The BFS chain is start (client) → ... → tainted; but the retro
      // format reads tainted-first. So reverse for printing.
      const reversed = [...l.chain].reverse();
      process.stderr.write(`Server-only module reaches client bundle:\n`);
      process.stderr.write(`  ${rel(reversed[0])}\n`);
      for (let i = 1; i < reversed.length; i++) {
        process.stderr.write(`    → ${rel(reversed[i])}\n`);
      }
      process.stderr.write('\n');
    }
    process.stderr.write(
      `Fix: split the module along the server/client boundary ` +
        `(see wiki/02-dev/tech-notes/2026-05-14-TM-133-audio-manifest-bundle-leak.md).\n`,
    );
  }
}

process.exit(leaks.length > 0 ? 1 : 0);
