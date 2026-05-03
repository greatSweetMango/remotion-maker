import { PrismaClient, Prisma } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';

export type { Prisma };

/**
 * Normalize DATABASE_URL so SQLite `file:` URLs are always absolute.
 *
 * Why: Next 16 + Turbopack + Prisma's engine subprocess sometimes resolve a
 * relative `file:./dev.db` against an unexpected CWD (observed:
 * `node_modules/.prisma/client/`). When that happens the engine creates an
 * empty SQLite file in the wrong directory and every query fails with
 * `The table 'main.User' does not exist in the current database.` even though
 * the real DB at `prisma/dev.db` is intact and populated.
 *
 * Fix (TM-96): at module load (which runs in the Next.js Node process where
 * `process.cwd()` is the project root) detect a relative `file:` URL and
 * rewrite it to an absolute path before constructing the Prisma client. The
 * engine then uses the absolute path verbatim and never drifts.
 *
 * Idempotent + safe for absolute paths, non-sqlite providers, and missing env.
 */
function normalizeDatabaseUrl(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) return;
  if (!raw.startsWith('file:')) return; // postgres/mysql/etc — nothing to do

  const rest = raw.slice('file:'.length);
  // Already absolute (`file:/foo/bar` or `file:///foo/bar`).
  if (rest.startsWith('/')) return;

  // Resolve relative path against project root. `process.cwd()` is reliable
  // here because this module is imported from Next.js server code which always
  // runs from the project root, never from inside node_modules.
  const projectRoot = process.cwd();
  // Strip a leading `./` for cleanliness; path.resolve handles either form.
  const relative = rest.replace(/^\.\//, '');
  const absolute = path.resolve(projectRoot, relative);
  const normalized = `file:${absolute}`;

  if (normalized === raw) return;

  // Sanity: warn if a rogue empty DB exists at the (wrong) cwd-of-engine —
  // this is the classic TM-96 symptom. Do not throw; the absolute path may
  // simply not have been migrated yet.
  if (process.env.NODE_ENV !== 'production') {
    const rogue = path.resolve(projectRoot, 'node_modules/.prisma/client', relative);
    const rogueExists = fs.existsSync(rogue);
    const realExists = fs.existsSync(absolute);
    if (rogueExists && !realExists) {
      // eslint-disable-next-line no-console
      console.warn(
        `[prisma] detected rogue empty DB at ${rogue} — using ${absolute} instead. ` +
          `Consider deleting the rogue file. (TM-96)`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.info(`[prisma] DATABASE_URL normalized: ${raw} -> ${normalized}`);
    }
  }

  process.env.DATABASE_URL = normalized;
}

normalizeDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
