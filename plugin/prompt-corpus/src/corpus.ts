/**
 * Prompt corpus loader (TM-105).
 *
 * A corpus is a JSON file under `corpora/` shaped as:
 *
 *   {
 *     "name": "tm-83-smoke",
 *     "description": "...",
 *     "prompts": [
 *       { "id": "char-01", "category": "character", "prompt": "..." },
 *       ...
 *     ]
 *   }
 *
 * Categories follow the TM-83/TM-85 axes:
 *   character | motion-graphics | data-viz | typography
 *
 * The loader is filesystem-driven so unit tests can swap in a mock root
 * directory (no need to read the on-disk static JSON).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CorpusCategory =
  | 'character'
  | 'motion-graphics'
  | 'data-viz'
  | 'typography';

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'character',
  'motion-graphics',
  'data-viz',
  'typography',
]);

export interface CorpusPrompt {
  id: string;
  category: CorpusCategory;
  prompt: string;
}

export interface Corpus {
  name: string;
  description: string;
  prompts: CorpusPrompt[];
}

export interface CorpusFs {
  readdir: typeof readdir;
  readFile: typeof readFile;
}

const defaultFs: CorpusFs = { readdir, readFile };

/**
 * Resolve the on-disk root for static corpora.
 *
 * In dev (tsx) we run from src/, so corpora/ is one level up.
 * After `tsc` build we run from dist/, so corpora/ is also one level up.
 * Both cases resolve to `<package_root>/corpora`.
 */
export function defaultCorpusRoot(metaUrl: string): string {
  // metaUrl is like file:///.../plugin/prompt-corpus/src/corpus.ts (dev)
  // or       file:///.../plugin/prompt-corpus/dist/corpus.js (build).
  const pathname = new URL('.', metaUrl).pathname;
  // strip trailing src/ or dist/ (with or without trailing slash)
  const pkgRoot = pathname.replace(/\/(src|dist)\/?$/, '');
  return join(pkgRoot, 'corpora');
}

/**
 * Validate and normalise a raw corpus JSON payload. Throws on malformed
 * input — caller is responsible for catching and surfacing the error.
 */
export function parseCorpus(raw: unknown, sourceHint = '<inline>'): Corpus {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${sourceHint}: corpus must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const name = obj.name;
  const description = obj.description ?? '';
  const prompts = obj.prompts;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${sourceHint}: corpus.name must be a non-empty string`);
  }
  if (typeof description !== 'string') {
    throw new Error(`${sourceHint}: corpus.description must be a string`);
  }
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error(`${sourceHint}: corpus.prompts must be a non-empty array`);
  }
  const seenIds = new Set<string>();
  const parsed: CorpusPrompt[] = prompts.map((p, idx) => {
    if (!p || typeof p !== 'object') {
      throw new Error(`${sourceHint}: prompts[${idx}] must be an object`);
    }
    const rec = p as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0) {
      throw new Error(`${sourceHint}: prompts[${idx}].id must be a non-empty string`);
    }
    if (typeof rec.category !== 'string' || !VALID_CATEGORIES.has(rec.category)) {
      throw new Error(
        `${sourceHint}: prompts[${idx}].category must be one of ${[...VALID_CATEGORIES].join('|')}`,
      );
    }
    if (typeof rec.prompt !== 'string' || rec.prompt.length === 0) {
      throw new Error(`${sourceHint}: prompts[${idx}].prompt must be a non-empty string`);
    }
    if (seenIds.has(rec.id)) {
      throw new Error(`${sourceHint}: duplicate prompt id "${rec.id}"`);
    }
    seenIds.add(rec.id);
    return {
      id: rec.id,
      category: rec.category as CorpusCategory,
      prompt: rec.prompt,
    };
  });
  return { name, description, prompts: parsed };
}

export interface CorpusStore {
  list(): Promise<string[]>;
  get(name: string): Promise<Corpus>;
}

/**
 * Build a corpus store backed by a filesystem directory of `*.json` files.
 * Filenames (sans `.json`) double as corpus identifiers; the in-file
 * `name` field must match to catch accidental rename drift.
 */
export function createFsStore(root: string, fs: CorpusFs = defaultFs): CorpusStore {
  return {
    async list(): Promise<string[]> {
      const entries = await fs.readdir(root);
      return entries
        .filter((e) => e.endsWith('.json'))
        .map((e) => e.slice(0, -'.json'.length))
        .sort();
    },
    async get(name: string): Promise<Corpus> {
      if (!/^[a-z0-9][a-z0-9\-_]*$/i.test(name)) {
        throw new Error(`invalid corpus name: ${JSON.stringify(name)}`);
      }
      const path = join(root, `${name}.json`);
      let raw: string;
      try {
        raw = await fs.readFile(path, 'utf8');
      } catch {
        throw new Error(`corpus "${name}" not found`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`corpus "${name}": invalid JSON (${(err as Error).message})`);
      }
      const corpus = parseCorpus(parsed, name);
      if (corpus.name !== name) {
        throw new Error(
          `corpus "${name}": file name does not match in-file name "${corpus.name}"`,
        );
      }
      return corpus;
    },
  };
}
