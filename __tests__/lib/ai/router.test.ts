/**
 * TM-189 — coverage hot-spot: `routePrompt` model router (TM-33).
 *
 * The router maps a classifier verdict + user tier onto a concrete model +
 * streaming recommendation. It was previously only exercised transitively;
 * this pins the full decision matrix with `classifyPrompt` / `getModels`
 * mocked so the unit stays render-light and API-key-free.
 */
import { routePrompt } from '@/lib/ai/router';

jest.mock('@/lib/ai/classify', () => ({
  classifyPrompt: jest.fn(),
}));
jest.mock('@/lib/ai/client', () => ({
  getModels: jest.fn(() => ({ free: 'model-free', pro: 'model-pro' })),
}));

import { classifyPrompt } from '@/lib/ai/classify';

const mockedClassify = classifyPrompt as jest.MockedFunction<typeof classifyPrompt>;

const classifierResult = (complexity: 'simple' | 'complex') => ({
  complexity,
  source: 'heuristic' as const,
  confidence: 0.9,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TM-189 routePrompt decision matrix', () => {
  it('routes simple prompts to the free model, non-streaming, for FREE tier', async () => {
    mockedClassify.mockResolvedValue(classifierResult('simple') as never);
    const d = await routePrompt('a red circle', 'FREE');
    expect(d.model).toBe('model-free');
    expect(d.streaming).toBe(false);
    expect(d.complexity).toBe('simple');
    expect(d.classifier.source).toBe('heuristic');
  });

  it('routes simple prompts to the free model even for PRO tier (Haiku speed)', async () => {
    mockedClassify.mockResolvedValue(classifierResult('simple') as never);
    const d = await routePrompt('a red circle', 'PRO');
    expect(d.model).toBe('model-free');
    expect(d.streaming).toBe(false);
  });

  it('routes complex prompts for FREE tier to the free model but streaming', async () => {
    mockedClassify.mockResolvedValue(classifierResult('complex') as never);
    const d = await routePrompt('multi-scene explainer', 'FREE');
    expect(d.model).toBe('model-free');
    expect(d.streaming).toBe(true);
    expect(d.complexity).toBe('complex');
  });

  it('routes complex prompts for PRO tier to the pro model, streaming', async () => {
    mockedClassify.mockResolvedValue(classifierResult('complex') as never);
    const d = await routePrompt('multi-scene explainer', 'PRO');
    expect(d.model).toBe('model-pro');
    expect(d.streaming).toBe(true);
  });

  it('defaults to FREE tier when tier is omitted', async () => {
    mockedClassify.mockResolvedValue(classifierResult('complex') as never);
    const d = await routePrompt('multi-scene explainer');
    expect(d.model).toBe('model-free');
    expect(d.streaming).toBe(true);
  });

  it('forwards the disableLLM opt through to the classifier', async () => {
    mockedClassify.mockResolvedValue(classifierResult('simple') as never);
    await routePrompt('a red circle', 'FREE', { disableLLM: true });
    expect(mockedClassify).toHaveBeenCalledWith('a red circle', { disableLLM: true });
  });

  it('always surfaces the classifier verdict on the decision', async () => {
    const verdict = classifierResult('complex');
    mockedClassify.mockResolvedValue(verdict as never);
    const d = await routePrompt('x', 'PRO');
    expect(d.classifier).toEqual(verdict);
  });
});
