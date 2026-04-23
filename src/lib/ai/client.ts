import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type AIProvider = 'anthropic' | 'openai';

export interface AIContentPart {
  type: 'text';
  text: string;
  cache?: boolean;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string | AIContentPart[];
}

export interface ChatCompleteOptions {
  model: string;
  system: string;
  messages: AIMessage[];
  maxTokens?: number;
}

function getProvider(): AIProvider {
  return (process.env.AI_PROVIDER as AIProvider) ?? 'anthropic';
}

export function getModels(): { free: string; pro: string } {
  const provider = getProvider();
  if (provider === 'openai') {
    return {
      free: process.env.AI_MODEL_FREE ?? 'gpt-4o-mini',
      pro: process.env.AI_MODEL_PRO ?? 'gpt-4o',
    };
  }
  return {
    free: process.env.AI_MODEL_FREE ?? 'claude-haiku-4-5-20251001',
    pro: process.env.AI_MODEL_PRO ?? 'claude-sonnet-4-6',
  };
}

export async function chatComplete({
  model,
  system,
  messages,
  maxTokens = 4096,
}: ChatCompleteOptions): Promise<string> {
  const provider = getProvider();

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((p) => p.text).join('\n'),
        })),
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  }

  // Anthropic
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const anthropicMessages = messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((p) => ({
        type: 'text' as const,
        text: p.text,
        ...(p.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      })),
    };
  });

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: anthropicMessages,
  });

  return message.content[0].type === 'text' ? message.content[0].text : '';
}
