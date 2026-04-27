/**
 * @jest-environment jsdom
 *
 * Evaluator unit tests + 25-template regression bench (TM-34).
 *
 * jsdom is needed because the evaluator imports React and produces
 * components that React.createElement against; the host doesn't actually
 * render here, but module-init touches DOM globals via lucide-react.
 */
import {
  evaluateComponent,
  clearEvaluatorCache,
  __evaluatorCacheSize,
  __evaluatorCacheConfig,
} from '@/lib/remotion/evaluator';
import { getTemplates } from '@/lib/templates';

describe('evaluateComponent — core', () => {
  beforeEach(() => clearEvaluatorCache());

  it('returns a React component for a minimal valid jsCode', () => {
    const jsCode = `
      const Component = () => null;
    `;
    const C = evaluateComponent(jsCode);
    expect(C).not.toBeNull();
    expect(typeof C).toBe('function');
  });

  it('returns null and does not throw on syntax error', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const C = evaluateComponent(`const = ;`);
    expect(C).toBeNull();
    errSpy.mockRestore();
  });

  it('returns null when no eligible component identifier is present', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const C = evaluateComponent(`const x = 1;`);
    expect(C).toBeNull();
    errSpy.mockRestore();
  });

  it('does not mistake SCREAMING_CASE constants for components (PARAMS regex gotcha)', () => {
    // Regression for tech-notes/2026-04-26-evaluator-params-bug.md
    const jsCode = `
      const PARAMS = { color: '#fff' };
      const Component = () => null;
    `;
    expect(evaluateComponent(jsCode)).not.toBeNull();
  });
});

describe('evaluateComponent — caching', () => {
  beforeEach(() => clearEvaluatorCache());

  it('returns the same component reference on repeat calls (cache hit)', () => {
    const jsCode = `const Component = () => null;`;
    const a = evaluateComponent(jsCode);
    const b = evaluateComponent(jsCode);
    expect(a).toBe(b);
    expect(__evaluatorCacheSize()).toBe(1);
  });

  it('evicts the oldest entry once MAX_CACHE_ENTRIES is exceeded', () => {
    const max = __evaluatorCacheConfig.MAX_CACHE_ENTRIES;
    for (let i = 0; i <= max; i++) {
      // Each jsCode unique → unique cache key.
      evaluateComponent(`const Component${i} = () => null; const Component = Component${i};`);
    }
    expect(__evaluatorCacheSize()).toBeLessThanOrEqual(max);
  });

  it('clearEvaluatorCache empties the cache', () => {
    evaluateComponent(`const Component = () => null;`);
    expect(__evaluatorCacheSize()).toBe(1);
    clearEvaluatorCache();
    expect(__evaluatorCacheSize()).toBe(0);
  });
});

describe('evaluateComponent — 35 template regression', () => {
  // The full template set must round-trip through the evaluator without
  // returning null. This is the canary for refactor regressions.
  it('all built-in templates evaluate to a non-null component', async () => {
    clearEvaluatorCache();
    const templates = await getTemplates();
    expect(templates.length).toBe(35);

    const failures: string[] = [];
    for (const tpl of templates) {
      const C = evaluateComponent(tpl.jsCode);
      if (!C) failures.push(tpl.id);
    }

    expect(failures).toEqual([]);
  });
});
