import { chatComplete, getModels } from './client';
import { GENERATION_SYSTEM_PROMPT } from './prompts';
import { extractParameters } from './extract-params';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import type { GeneratedAsset } from '@/types';

export async function generateAsset(
  prompt: string,
  model: string = getModels().free
): Promise<GeneratedAsset> {
  const text = await chatComplete({
    model,
    system: GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  const { title, code, durationInFrames, fps, width, height } = parsed;

  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(`Generated code failed security check: ${validation.errors.join(', ')}`);
  }

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);
  const parameters = extractParameters(code);

  return {
    id: crypto.randomUUID(),
    title,
    code,
    jsCode,
    parameters,
    durationInFrames: durationInFrames || 150,
    fps: fps || 30,
    width: width || 1920,
    height: height || 1080,
  };
}
