import { layoutVersions } from '@/components/studio/HistoryGraph';
import type { AssetVersion } from '@/types';

function v(id: string, parentId: string | null | undefined, prompt = id): AssetVersion {
  return {
    id,
    parentId,
    code: '',
    jsCode: '',
    parameters: [],
    prompt,
    createdAt: '2026-04-26T00:00:00Z',
  };
}

describe('layoutVersions', () => {
  it('returns [] for empty input', () => {
    expect(layoutVersions([])).toEqual([]);
  });

  it('lays out a linear chain in column 0', () => {
    const versions = [
      v('a', null),
      v('b', 'a'),
      v('c', 'b'),
    ];
    const nodes = layoutVersions(versions);
    expect(nodes.map((n) => [n.row, n.col])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('forks a second child into a new column', () => {
    // a -> b (trunk), a -> c (fork)
    const versions = [
      v('a', null),
      v('b', 'a'),
      v('c', 'a'),
    ];
    const nodes = layoutVersions(versions);
    const byId = Object.fromEntries(nodes.map((n) => [n.version.id, n]));
    expect([byId.a.row, byId.a.col]).toEqual([0, 0]);
    expect([byId.b.row, byId.b.col]).toEqual([1, 0]); // trunk inherits col 0
    expect([byId.c.row, byId.c.col]).toEqual([1, 1]); // fork allocates col 1
    expect(byId.c.parentCol).toBe(0);
    expect(byId.c.parentRow).toBe(0);
  });

  it('handles restore-then-edit branch (Figma-style)', () => {
    // a -> b -> c, then user restores 'a' and edits → d (parent = a)
    const versions = [
      v('a', null),
      v('b', 'a'),
      v('c', 'b'),
      v('d', 'a'),
    ];
    const nodes = layoutVersions(versions);
    const byId = Object.fromEntries(nodes.map((n) => [n.version.id, n]));
    expect(byId.d.row).toBe(1);
    expect(byId.d.col).toBe(1); // forks to column 1
    expect(byId.d.parentCol).toBe(0);
  });

  it('falls back to linear chain when parentId is missing (legacy data)', () => {
    const versions = [
      // No parentId on any version → previous-index heuristic.
      { id: 'a', code: '', jsCode: '', parameters: [], prompt: 'a', createdAt: '' },
      { id: 'b', code: '', jsCode: '', parameters: [], prompt: 'b', createdAt: '' },
      { id: 'c', code: '', jsCode: '', parameters: [], prompt: 'c', createdAt: '' },
    ] as AssetVersion[];
    const nodes = layoutVersions(versions);
    expect(nodes.map((n) => [n.row, n.col])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('treats a parentId pointing at a missing version as a new root', () => {
    const versions = [
      v('a', 'ghost'), // ghost id not present → null parent → root
      v('b', 'a'),
    ];
    const nodes = layoutVersions(versions);
    const byId = Object.fromEntries(nodes.map((n) => [n.version.id, n]));
    expect(byId.a.parentRow).toBe(null);
    expect([byId.b.row, byId.b.col]).toEqual([1, 0]);
  });
});
