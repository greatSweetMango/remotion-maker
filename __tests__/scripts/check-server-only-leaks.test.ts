/**
 * TM-134 — fixture-based tests for the server-only leak detector.
 *
 * Each fixture under `__tests__/scripts/fixtures/<name>/src/**` is a
 * miniature project root. The script is invoked with `--root <fixture>`
 * and `--json` so behavior can be asserted structurally.
 */
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '..', '..', 'scripts/ci/check-server-only-leaks.mjs');
const FIXTURES = resolve(__dirname, 'fixtures');

function run(fixture: string) {
  const root = join(FIXTURES, fixture);
  const res = spawnSync('node', [SCRIPT, '--root', root, '--json'], {
    encoding: 'utf8',
  });
  return {
    code: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    json: res.stdout ? JSON.parse(res.stdout) : null,
  };
}

describe('check-server-only-leaks.mjs', () => {
  it('passes when client only imports client-safe modules', () => {
    const r = run('leak-good');
    expect(r.code).toBe(0);
    expect(r.json.leaks).toEqual([]);
  });

  it('fails when a client component directly imports a server-only module', () => {
    const r = run('leak-bad');
    expect(r.code).toBe(1);
    expect(r.json.leaks).toHaveLength(1);
    expect(r.json.leaks[0].tainted).toMatch(/lib\/server-thing\.ts$/);
    // chain reads client seed → ... → tainted
    const chain = r.json.leaks[0].chain as string[];
    expect(chain[0]).toMatch(/Widget\.tsx$/);
    expect(chain[chain.length - 1]).toMatch(/server-thing\.ts$/);
  });

  it('detects transitive leaks through an intermediate module (no server-only sentinel)', () => {
    const r = run('leak-bad-deep');
    expect(r.code).toBe(1);
    expect(r.json.leaks).toHaveLength(1);
    expect(r.json.leaks[0].tainted).toMatch(/lib\/server-thing\.ts$/);
    expect((r.json.leaks[0].chain as string[]).some((p) => p.endsWith('middle.ts'))).toBe(true);
  });

  it("treats 'use server' modules as RPC boundaries (no leak)", () => {
    // Client imports server-action file; server-action file imports
    // server-only db. Next compiles the action to an RPC stub for the
    // client, so db.ts never reaches the browser bundle.
    const r = run('leak-action-boundary');
    expect(r.code).toBe(0);
    expect(r.json.leaks).toEqual([]);
  });
});
