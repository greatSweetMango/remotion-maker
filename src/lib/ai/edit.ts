import Anthropic from '@anthropic-ai/sdk';
import { EDIT_SYSTEM_PROMPT, buildEditMessages } from './prompts';
import { extractParameters } from './extract-params';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import type { GeneratedAsset } from '@/types';

const client = new Anthropic();

export async function editAsset(
  existingCode: string,
  userRequest: string,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' = 'claude-sonnet-4-6'
): Promise<GeneratedAsset> {
  const messages = buildEditMessages(existingCode, userRequest);

  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: EDIT_SYSTEM_PROMPT,
    messages,
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  const { title, code, durationInFrames, fps, width, height } = parsed;

  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(`Edited code failed security check: ${validation.errors.join(', ')}`);
  }

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);
  const parameters = extractParameters(code);

  return {
    id: crypto.randomUUID(),
    title: title || 'Edited Asset',
    code,
    jsCode,
    parameters,
    durationInFrames: durationInFrames || 150,
    fps: fps || 30,
    width: width || 1920,
    height: height || 1080,
  };
}
