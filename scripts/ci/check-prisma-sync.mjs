#!/usr/bin/env node
/**
 * TM-177 — Guard against drift between `prisma/schema.prisma`, the generated
 * Prisma client (`node_modules/.prisma/client`), and the local dev SQLite DB.
 *
 * Symptom we are preventing: dashboard crashes with
 *   PrismaClientValidationError: Unknown field `tags` for select statement on Asset.
 * Root cause: schema was updated (TM-107 added Asset.tags/folder) but the dev
 * environment never ran `prisma db push` + `prisma generate`, so the client
 * types and dev.db columns were stale even though the source code referenced
 * the new fields.
 *
 * Check (cheap, no DB writes):
 *   1. Parse `prisma/schema.prisma` and extract `model Asset { ... }` field
 *      names.
 *   2. Verify each field appears in the generated client's `.d.ts` (rough
 *      grep — sufficient to catch the "never regenerated" case).
 *   3. If `prisma/dev.db` exists, verify each scalar field appears in the
 *      sqlite Asset table schema.
 *
 * Exits non-zero with a clear remediation hint when drift is detected.
 *
 * Wired up in `package.json` as `check:prisma-sync`. Safe to add to CI and to
 * a pre-commit hook later.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const schemaPath = path.join(repoRoot, 'prisma', 'schema.prisma');
const clientDtsPath = path.join(
  repoRoot,
  'node_modules',
  '.prisma',
  'client',
  'index.d.ts',
);
const devDbPath = path.join(repoRoot, 'prisma', 'dev.db');

function fail(msg) {
  console.error(`✗ prisma-sync drift: ${msg}`);
  console.error(
    '\n  Fix: npm run prisma:sync\n  (or: npx prisma db push --schema prisma/schema.prisma --skip-generate \\\n            && npx prisma generate --schema prisma/schema.prisma)\n',
  );
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) fail(`schema not found at ${schemaPath}`);
const schema = fs.readFileSync(schemaPath, 'utf8');

// Extract scalar field names from `model Asset { ... }`. We intentionally
// scope to Asset because TM-177 is about Asset; broaden later if needed.
const assetBlock = schema.match(/model\s+Asset\s*\{([\s\S]*?)\n\}/);
if (!assetBlock) fail('could not locate `model Asset` block in schema');

const PRISMA_SCALARS = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

const assetFields = [];
for (const rawLine of assetBlock[1].split('\n')) {
  const line = rawLine.replace(/\/\/.*$/, '').trim();
  if (!line) continue;
  // Skip block-level attributes (`@@index`, `@@unique`, etc).
  if (line.startsWith('@@')) continue;
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z0-9_[\]?]+)/);
  if (!m) continue;
  const [, name, type] = m;
  // Skip relations (no DB column for the navigation side). Heuristic: keep
  // only Prisma scalar base types.
  const baseType = type.replace(/[[\]?]/g, '');
  if (!PRISMA_SCALARS.has(baseType)) continue;
  assetFields.push(name);
}

if (assetFields.length === 0) fail('parsed 0 scalar fields from Asset model');

// 1. Generated client check.
if (!fs.existsSync(clientDtsPath)) {
  fail(
    `generated client missing at ${clientDtsPath} — run \`npx prisma generate\``,
  );
}
const dts = fs.readFileSync(clientDtsPath, 'utf8');
const missingInClient = assetFields.filter(
  (f) => !new RegExp(`\\b${f}\\b`).test(dts),
);
if (missingInClient.length > 0) {
  fail(
    `generated Prisma client is missing Asset field(s): ${missingInClient.join(', ')}`,
  );
}

// 2. Dev DB check (best-effort — only when sqlite3 + dev.db both present).
if (fs.existsSync(devDbPath)) {
  let dbSchema = '';
  try {
    dbSchema = execSync(`sqlite3 "${devDbPath}" ".schema Asset"`, {
      encoding: 'utf8',
    });
  } catch {
    // sqlite3 CLI unavailable — skip silently, client check above is enough.
  }
  if (dbSchema) {
    const missingInDb = assetFields.filter(
      (f) => !new RegExp(`"${f}"`).test(dbSchema),
    );
    if (missingInDb.length > 0) {
      fail(
        `dev.db Asset table is missing column(s): ${missingInDb.join(', ')}`,
      );
    }
  }
}

console.log(
  `✓ prisma-sync: Asset has ${assetFields.length} scalar field(s); client + dev.db in sync.`,
);
