import { classifyPrompt, type Complexity, type ClassifyResult } from './classify';
import { getModels } from './client';

/**
 * Model router (TM-33).
 *
 * simple  → free tier model (Haiku)         — direct, non-streaming
 * complex → pro  tier model (Sonnet)        — streaming, progressive parse
 *
 * Returned `streaming` is a *recommendation*; the API route decides
 * whether to honour it based on transport (e.g. SSE-capable).
 */

export interface RouteDecision {
  model: string;
  streaming: boolean;
  complexity: Complexity;
  classifier: ClassifyResult;
}

export async function routePrompt(
  prompt: string,
  userTier: 'FREE' | 'PRO' = 'FREE',
  opts?: { disableLLM?: boolean },
): Promise<RouteDecision> {
  const classifier = await classifyPrompt(prompt, opts);
  const models = getModels();

  // PRO users always get the pro model on complex; on simple they still
  // benefit from Haiku speed. FREE users only ever get the free model.
  if (classifier.complexity === 'simple') {
    return {
      model: models.free,
      streaming: false,
      complexity: 'simple',
      classifier,
    };
  }

  return {
    model: userTier === 'PRO' ? models.pro : models.free,
    streaming: true,
    complexity: 'complex',
    classifier,
  };
}
