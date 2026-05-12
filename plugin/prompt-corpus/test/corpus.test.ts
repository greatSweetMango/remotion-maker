/**
 * Unit tests for prompt-corpus loader (TM-105).
 *
 * Uses Node's built-in node:test + tsx. Filesystem is mocked via the
 * CorpusFs injection point — no on-disk reads.
 *
 * Coverage targets:
 *  - parseCorpus: happy-path + every validation branch
 *  - createFsStore.list(): filters non-json + sorts
 *  - createFsStore.get(): happy-path + ENOENT + bad JSON + name/file mismatch + injection-safe name regex
 *  - Static built-in corpora (tm-83-smoke, tm-85-regression) load and
 *    satisfy size + category-coverage invariants
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseCorpus,
  createFsStore,
  defaultCorpusRoot,
  type CorpusFs,
} from '../src/corpus.ts';

// ─── parseCorpus ────────────────────────────────────────────────────

test('parseCorpus: accepts a well-formed corpus', () => {
  const c = parseCorpus({
    name: 'demo',
    description: 'd',
    prompts: [
      { id: 'a', category: 'character', prompt: 'hi' },
      { id: 'b', category: 'data-viz', prompt: 'count to 10' },
    ],
  });
  assert.equal(c.name, 'demo');
  assert.equal(c.prompts.length, 2);
  assert.equal(c.prompts[1].category, 'data-viz');
});

test('parseCorpus: rejects non-object root', () => {
  assert.throws(() => parseCorpus(null), /must be an object/);
  assert.throws(() => parseCorpus(42), /must be an object/);
});

test('parseCorpus: rejects empty / missing name', () => {
  assert.throws(
    () => parseCorpus({ description: 'd', prompts: [{ id: 'a', category: 'character', prompt: 'p' }] }),
    /name/,
  );
  assert.throws(
    () => parseCorpus({ name: '', description: 'd', prompts: [{ id: 'a', category: 'character', prompt: 'p' }] }),
    /name/,
  );
});

test('parseCorpus: rejects empty prompts array', () => {
  assert.throws(
    () => parseCorpus({ name: 'x', description: 'd', prompts: [] }),
    /non-empty array/,
  );
});

test('parseCorpus: rejects invalid category', () => {
  assert.throws(
    () => parseCorpus({
      name: 'x',
      description: 'd',
      prompts: [{ id: 'a', category: 'bogus', prompt: 'p' }],
    }),
    /category must be one of/,
  );
});

test('parseCorpus: rejects empty prompt text', () => {
  assert.throws(
    () => parseCorpus({
      name: 'x',
      description: 'd',
      prompts: [{ id: 'a', category: 'character', prompt: '' }],
    }),
    /prompt must be a non-empty string/,
  );
});

test('parseCorpus: rejects duplicate ids', () => {
  assert.throws(
    () => parseCorpus({
      name: 'x',
      description: 'd',
      prompts: [
        { id: 'a', category: 'character', prompt: 'p' },
        { id: 'a', category: 'data-viz', prompt: 'q' },
      ],
    }),
    /duplicate prompt id/,
  );
});

test('parseCorpus: defaults description to empty string when missing', () => {
  const c = parseCorpus({
    name: 'x',
    prompts: [{ id: 'a', category: 'character', prompt: 'p' }],
  });
  assert.equal(c.description, '');
});

// ─── createFsStore ──────────────────────────────────────────────────

function mockFs(files: Record<string, string>): CorpusFs {
  return {
    readdir: (async () => Object.keys(files)) as unknown as CorpusFs['readdir'],
    readFile: (async (path: string) => {
      const key = String(path).split('/').pop()!;
      if (!(key in files)) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return files[key];
    }) as unknown as CorpusFs['readFile'],
  };
}

test('createFsStore.list: filters non-json and sorts', async () => {
  const store = createFsStore('/fake', mockFs({
    'zeta.json': '{}',
    'alpha.json': '{}',
    'README.md': 'ignore',
  }));
  assert.deepEqual(await store.list(), ['alpha', 'zeta']);
});

test('createFsStore.get: returns a parsed corpus', async () => {
  const store = createFsStore('/fake', mockFs({
    'demo.json': JSON.stringify({
      name: 'demo',
      description: 'd',
      prompts: [{ id: 'a', category: 'character', prompt: 'p' }],
    }),
  }));
  const c = await store.get('demo');
  assert.equal(c.name, 'demo');
  assert.equal(c.prompts.length, 1);
});

test('createFsStore.get: throws on missing corpus', async () => {
  const store = createFsStore('/fake', mockFs({}));
  await assert.rejects(store.get('missing'), /not found/);
});

test('createFsStore.get: throws on invalid JSON', async () => {
  const store = createFsStore('/fake', mockFs({
    'bad.json': '{ not json',
  }));
  await assert.rejects(store.get('bad'), /invalid JSON/);
});

test('createFsStore.get: throws when in-file name mismatches filename', async () => {
  const store = createFsStore('/fake', mockFs({
    'demo.json': JSON.stringify({
      name: 'wrong',
      description: 'd',
      prompts: [{ id: 'a', category: 'character', prompt: 'p' }],
    }),
  }));
  await assert.rejects(store.get('demo'), /file name does not match/);
});

test('createFsStore.get: rejects path-traversal corpus names', async () => {
  const store = createFsStore('/fake', mockFs({}));
  await assert.rejects(store.get('../etc/passwd'), /invalid corpus name/);
  await assert.rejects(store.get('foo/bar'), /invalid corpus name/);
  await assert.rejects(store.get(''), /invalid corpus name/);
});

// ─── Built-in static corpora ────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORA_ROOT = join(HERE, '..', 'corpora');

test('built-in corpora: tm-83-smoke loads and is sized correctly', async () => {
  const store = createFsStore(CORPORA_ROOT, { readdir, readFile });
  const c = await store.get('tm-83-smoke');
  assert.equal(c.name, 'tm-83-smoke');
  assert.equal(c.prompts.length, 14, 'TM-83 smoke must be 14 prompts');
  const cats = new Set(c.prompts.map((p) => p.category));
  assert.deepEqual(
    [...cats].sort(),
    ['character', 'data-viz', 'motion-graphics', 'typography'],
    'must cover all four categories',
  );
});

test('built-in corpora: tm-85-regression loads and is sized correctly', async () => {
  const store = createFsStore(CORPORA_ROOT, { readdir, readFile });
  const c = await store.get('tm-85-regression');
  assert.equal(c.name, 'tm-85-regression');
  assert.equal(c.prompts.length, 30, 'TM-85 regression must be 30 prompts');
  const cats = new Set(c.prompts.map((p) => p.category));
  assert.deepEqual(
    [...cats].sort(),
    ['character', 'data-viz', 'motion-graphics', 'typography'],
    'must cover all four categories',
  );
});

test('built-in corpora: list() surfaces both static corpora', async () => {
  const store = createFsStore(CORPORA_ROOT, { readdir, readFile });
  const names = await store.list();
  assert.ok(names.includes('tm-83-smoke'), `expected tm-83-smoke in ${names.join(',')}`);
  assert.ok(names.includes('tm-85-regression'), `expected tm-85-regression in ${names.join(',')}`);
});

test('defaultCorpusRoot: resolves to <pkg>/corpora from src/', () => {
  const root = defaultCorpusRoot('file:///some/pkg/src/corpus.ts');
  assert.equal(root, '/some/pkg/corpora');
});

test('defaultCorpusRoot: resolves to <pkg>/corpora from dist/', () => {
  const root = defaultCorpusRoot('file:///some/pkg/dist/corpus.js');
  assert.equal(root, '/some/pkg/corpora');
});
