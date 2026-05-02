#!/usr/bin/env node
/**
 * TM-76 — Asset lifecycle QA (ADR-0010 fork lineage live verification).
 *
 * Flow:
 *   1) Seed two users (FREE + PRO) via Prisma direct.
 *   2) Login both via NextAuth credentials → cookie jar per user.
 *   3) FREE: /api/generate → asset.id (a)
 *   4) FREE: /api/edit (a) → expect AssetVersion +1.
 *   5) FREE: /api/asset/:a/share → publicSlug.
 *   6) PRO:  /api/asset/fork {slug} → fork asset.id (b) — verify sourceAssetId === a.
 *   7) PRO:  GET /api/assets → expect b in listing.
 *   8) FREE: GET /api/asset/:b/share → expect 403/404 (not owner).
 *   9) FREE: DELETE /api/asset/:a → soft-delete (deletedAt set), version still exists.
 *  10) Hard-delete original asset directly via Prisma → cascade should delete versions
 *      AND null fork.sourceAssetId (Asset.sourceAsset onDelete: SetNull).
 *
 * Outputs:
 *   wiki/05-reports/screenshots/TM-76/results.json
 *   wiki/05-reports/screenshots/TM-76/summary.json
 *
 * Bugs (parameter, schema mismatches, 401/403 missing) are recorded in summary.bugs[].
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-76');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:3076';
const FREE_EMAIL = 'tm76-free@localhost';
const PRO_EMAIL  = 'tm76-pro@localhost';
const PASSWORD = 'tm76-test-pwd';

const DB_PATH = path.join(ROOT, 'prisma', 'dev.db');
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${DB_PATH}` } },
});

const bugs = [];
const events = [];
function log(...args) { console.log(...args); events.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); }
function bug(severity, area, msg, meta = {}) {
  const entry = { severity, area, msg, meta };
  bugs.push(entry);
  log(`!! BUG[${severity}] [${area}] ${msg}`, meta);
}

async function seedUser(email, tier) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hash, tier },
    create: { email, name: email, password: hash, tier },
  });
  return user;
}

// --- NextAuth credentials login → cookie jar -------------------------------
function parseSetCookies(headers) {
  // Node fetch returns a Headers obj with multiple Set-Cookie merged via getSetCookie().
  const arr = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const out = [];
  for (const c of arr) {
    const first = c.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) out.push({ name: first.slice(0, eq), value: first.slice(eq + 1) });
  }
  return out;
}

class Jar {
  constructor() { this.cookies = new Map(); }
  ingest(headers) {
    for (const c of parseSetCookies(headers)) {
      this.cookies.set(c.name, c.value);
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function login(email) {
  const jar = new Jar();
  // 1) GET csrf
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { cookie: jar.header() },
  });
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();

  // 2) POST credentials callback
  const form = new URLSearchParams({
    csrfToken,
    email,
    password: PASSWORD,
    callbackUrl: `${BASE}/studio`,
    json: 'true',
  });
  const cbRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      cookie: jar.header(),
    },
    body: form.toString(),
    redirect: 'manual',
  });
  jar.ingest(cbRes.headers);

  // 3) Verify session
  const sessRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: jar.header() },
  });
  const session = await sessRes.json();
  if (!session?.user?.id) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(session)}`);
  }
  log(`login OK email=${email} userId=${session.user.id} tier=${session.user.tier}`);
  return { jar, userId: session.user.id, tier: session.user.tier };
}

async function api(jar, method, endpoint, body) {
  const t0 = Date.now();
  const init = {
    method,
    headers: { cookie: jar.header() },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${endpoint}`, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, latencyMs: Date.now() - t0, json, text };
}

// ---------------------------------------------------------------------------

const startedAt = new Date().toISOString();
const steps = [];

try {
  // 1) Seed
  log('=== Step 1: seed users ===');
  const freeUser = await seedUser(FREE_EMAIL, 'FREE');
  const proUser  = await seedUser(PRO_EMAIL, 'PRO');
  log(`seeded FREE userId=${freeUser.id} PRO userId=${proUser.id}`);

  // Clean any leftovers from previous runs
  await prisma.asset.deleteMany({ where: { userId: { in: [freeUser.id, proUser.id] } } });

  // 2) Login both
  log('=== Step 2: login both users ===');
  const free = await login(FREE_EMAIL);
  const pro  = await login(PRO_EMAIL);

  // 3) FREE generate
  log('=== Step 3: FREE /api/generate ===');
  const genPrompt = 'Animated counter from 0 to 100, blue, 3 seconds';
  const gen = await api(free.jar, 'POST', '/api/generate', { prompt: genPrompt });
  steps.push({ step: 'generate', status: gen.status, latencyMs: gen.latencyMs, body: gen.json });
  if (!gen.ok || gen.json?.type !== 'generate') {
    bug('CRITICAL', 'generate', 'generate failed', { status: gen.status, body: gen.json ?? gen.text.slice(0, 200) });
    throw new Error('generate failed');
  }
  const assetA = gen.json.asset;
  log(`generated assetA.id=${assetA.id} latency=${gen.latencyMs}ms`);

  // Verify version row
  let versions = await prisma.assetVersion.findMany({ where: { assetId: assetA.id } });
  log(`versions after generate: ${versions.length}`);
  if (versions.length !== 1) bug('HIGH', 'generate', 'expected 1 version after generate', { actual: versions.length });

  // 4) FREE edit
  log('=== Step 4: FREE /api/edit ===');
  const ed = await api(free.jar, 'POST', '/api/edit', {
    assetId: assetA.id,
    prompt: 'Change the primary color to red',
    currentCode: assetA.code,
  });
  steps.push({ step: 'edit', status: ed.status, latencyMs: ed.latencyMs, ok: ed.ok, error: ed.json?.error });
  if (!ed.ok) {
    bug('HIGH', 'edit', 'edit failed', { status: ed.status, body: ed.json ?? ed.text.slice(0, 300) });
  } else {
    log(`edit OK latency=${ed.latencyMs}ms`);
  }
  versions = await prisma.assetVersion.findMany({
    where: { assetId: assetA.id },
    orderBy: { createdAt: 'asc' },
  });
  log(`versions after edit: ${versions.length}`);
  if (versions.length !== 2) bug('HIGH', 'edit', 'expected 2 versions after edit', { actual: versions.length });

  // 5) Share
  log('=== Step 5: FREE /api/asset/:id/share ===');
  const sh = await api(free.jar, 'POST', `/api/asset/${assetA.id}/share`);
  steps.push({ step: 'share', status: sh.status, body: sh.json });
  if (!sh.ok || !sh.json?.slug) {
    bug('CRITICAL', 'share', 'share failed', { status: sh.status, body: sh.json });
    throw new Error('share failed');
  }
  const slug = sh.json.slug;
  log(`shared slug=${slug}`);

  // 6) PRO fork
  log('=== Step 6: PRO /api/asset/fork ===');
  const fk = await api(pro.jar, 'POST', '/api/asset/fork', { slug });
  steps.push({ step: 'fork', status: fk.status, body: fk.json });
  if (!fk.ok) {
    bug('CRITICAL', 'fork', 'fork failed', { status: fk.status, body: fk.json });
    throw new Error('fork failed');
  }
  const forkId = fk.json.id;
  log(`forked forkId=${forkId} sourceAssetId(api)=${fk.json.sourceAssetId}`);
  if (fk.json.sourceAssetId !== assetA.id) {
    bug('CRITICAL', 'fork', 'fork response sourceAssetId mismatch', { expected: assetA.id, actual: fk.json.sourceAssetId });
  }

  // Verify in DB
  const forkRow = await prisma.asset.findUnique({ where: { id: forkId } });
  log(`fork DB row: userId=${forkRow.userId} sourceAssetId=${forkRow.sourceAssetId} publicSlug=${forkRow.publicSlug} sharedAt=${forkRow.sharedAt}`);
  if (forkRow.sourceAssetId !== assetA.id) bug('CRITICAL', 'fork', 'DB sourceAssetId mismatch');
  if (forkRow.userId !== pro.userId)        bug('CRITICAL', 'fork', 'fork ownership mismatch');
  if (forkRow.publicSlug)                   bug('MEDIUM',   'fork', 'fork should not inherit publicSlug', { slug: forkRow.publicSlug });
  if (forkRow.sharedAt)                     bug('MEDIUM',   'fork', 'fork should not inherit sharedAt');

  // 7) PRO list
  log('=== Step 7: PRO GET /api/assets ===');
  const list = await api(pro.jar, 'GET', '/api/assets');
  const found = list.json?.assets?.find((a) => a.id === forkId);
  steps.push({ step: 'list', status: list.status, found: !!found });
  if (!found) bug('HIGH', 'list', 'fork not visible in PRO listing');
  else log(`PRO listing contains fork: title=${found.title}`);

  // 8) Cross-user access — FREE tries to PATCH/DELETE/share PRO's fork
  log('=== Step 8: cross-user access checks ===');
  const xShare = await api(free.jar, 'POST', `/api/asset/${forkId}/share`);
  steps.push({ step: 'cross-share', status: xShare.status });
  log(`FREE → POST share on PRO fork: status=${xShare.status}`);
  if (![403, 404].includes(xShare.status)) bug('HIGH', 'authz', 'FREE could share PRO fork', { status: xShare.status, body: xShare.json });

  const xDel = await api(free.jar, 'DELETE', `/api/asset/${forkId}`);
  steps.push({ step: 'cross-delete', status: xDel.status });
  log(`FREE → DELETE on PRO fork: status=${xDel.status}`);
  if (![403, 404].includes(xDel.status)) bug('CRITICAL', 'authz', 'FREE could delete PRO fork', { status: xDel.status, body: xDel.json });

  // Verify still alive
  const postXdel = await prisma.asset.findUnique({ where: { id: forkId } });
  if (!postXdel || postXdel.deletedAt) bug('CRITICAL', 'authz', 'PRO fork was modified by FREE attempt', { row: postXdel });

  // 9) FREE soft-delete original
  log('=== Step 9: FREE soft-delete original ===');
  const del = await api(free.jar, 'DELETE', `/api/asset/${assetA.id}`);
  steps.push({ step: 'soft-delete', status: del.status, body: del.json });
  log(`soft-delete status=${del.status} body=${JSON.stringify(del.json)}`);
  if (!del.ok) bug('HIGH', 'delete', 'soft-delete failed', { status: del.status });

  const postSoft = await prisma.asset.findUnique({
    where: { id: assetA.id },
    include: { versions: true },
  });
  log(`after soft-delete: deletedAt=${postSoft?.deletedAt} versions=${postSoft?.versions.length}`);
  if (!postSoft?.deletedAt) bug('HIGH', 'delete', 'deletedAt not set after DELETE');
  if ((postSoft?.versions.length ?? 0) === 0) bug('MEDIUM', 'delete', 'versions removed on soft-delete (unexpected — should be cascade only on hard-delete)');

  // Fork should still exist & still have sourceAssetId pointing at the (now soft-deleted) original
  const forkAfterSoft = await prisma.asset.findUnique({ where: { id: forkId } });
  log(`fork after soft-delete: sourceAssetId=${forkAfterSoft?.sourceAssetId}`);
  if (forkAfterSoft?.sourceAssetId !== assetA.id) bug('HIGH', 'delete', 'fork.sourceAssetId changed on soft-delete');

  // FREE listing should NOT include soft-deleted asset
  const freeList = await api(free.jar, 'GET', '/api/assets');
  if (freeList.json?.assets?.some((a) => a.id === assetA.id)) {
    bug('HIGH', 'delete', 'soft-deleted asset still visible in /api/assets');
  } else {
    log('soft-deleted asset correctly hidden from /api/assets');
  }

  // 10) Hard-delete via Prisma to verify cascade + SetNull
  log('=== Step 10: Prisma hard-delete original (cascade test) ===');
  await prisma.asset.delete({ where: { id: assetA.id } });
  const versionsHard = await prisma.assetVersion.findMany({ where: { assetId: assetA.id } });
  log(`versions after hard-delete: ${versionsHard.length} (should be 0 — onDelete: Cascade)`);
  if (versionsHard.length !== 0) bug('CRITICAL', 'cascade', 'AssetVersion not cascaded on hard-delete');

  const forkAfterHard = await prisma.asset.findUnique({ where: { id: forkId } });
  log(`fork after hard-delete: sourceAssetId=${forkAfterHard?.sourceAssetId}`);
  if (!forkAfterHard) bug('CRITICAL', 'cascade', 'fork was destroyed by source hard-delete');
  else if (forkAfterHard.sourceAssetId !== null) bug('HIGH', 'cascade', 'sourceAssetId not nulled on parent hard-delete (expected SetNull)', { actual: forkAfterHard.sourceAssetId });

  // 11) Orphan check across DB
  log('=== Step 11: orphan check ===');
  const orphanedVersions = await prisma.$queryRaw`
    SELECT v.id FROM AssetVersion v LEFT JOIN Asset a ON a.id = v.assetId WHERE a.id IS NULL
  `;
  log(`orphan versions: ${orphanedVersions.length}`);
  if (orphanedVersions.length > 0) bug('HIGH', 'integrity', 'orphan AssetVersion rows in DB', { ids: orphanedVersions });

  const orphanedForks = await prisma.$queryRaw`
    SELECT a.id, a.sourceAssetId FROM Asset a
      WHERE a.sourceAssetId IS NOT NULL
        AND a.sourceAssetId NOT IN (SELECT id FROM Asset)
  `;
  log(`forks pointing to missing source (should be 0 due to SetNull): ${orphanedForks.length}`);
  if (orphanedForks.length > 0) bug('HIGH', 'integrity', 'fork rows pointing at missing source', { rows: orphanedForks });

  log('=== DONE ===');
} catch (err) {
  log(`FATAL: ${err.message}`);
  bugs.push({ severity: 'FATAL', area: 'driver', msg: err.message, meta: { stack: err.stack?.split('\n').slice(0, 3) } });
} finally {
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    base: BASE,
    bugs,
    bugCount: bugs.length,
    severityCounts: bugs.reduce((acc, b) => { acc[b.severity] = (acc[b.severity] ?? 0) + 1; return acc; }, {}),
    steps,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'events.log'), events.join('\n'));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
  process.exit(bugs.some((b) => ['CRITICAL', 'FATAL'].includes(b.severity)) ? 1 : 0);
}
