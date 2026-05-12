#!/usr/bin/env node
/**
 * mcp-llm-judge — MCP stdio server exposing two tools (TM-103):
 *
 *   judge_visual(image_url, criteria?, model?) → { scores, reasoning, raw_response, overall, needs_review }
 *   judge_code(code, criteria?, model?)         → same shape, different axes
 *
 * Standardises the LLM-as-judge infra from TM-46/TM-66 so other tasks
 * can reuse the same rubric + determinism guarantees (ADR-0017/0018:
 * temperature=0, seed=42).
 *
 * TM-66 callsite migration is intentionally out of scope and tracked as
 * a follow-up (TM-111) per task spec.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { judgeCode, judgeVisual, type ChatLikeClient } from './judge.js';

const TOOL_VISUAL = 'judge_visual';
const TOOL_CODE = 'judge_code';

const server = new Server(
  {
    name: 'mcp-llm-judge',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: TOOL_VISUAL,
        description:
          'LLM-as-judge for images. Scores 1-10 on { clarity, fidelity, aesthetic, intent_match }. Defaults to gpt-4o, multimodal. Deterministic (temperature=0, seed=42; ADR-0018). Returns { scores, reasoning, raw_response, overall (0-100), needs_review }.',
        inputSchema: {
          type: 'object',
          properties: {
            image_url: {
              type: 'string',
              description:
                'Image to grade. Either a `data:image/png;base64,...` URL or an https URL the model can fetch.',
            },
            criteria: {
              type: 'string',
              description:
                'Optional extra grading criteria appended to the system prompt (e.g. original user intent / prompt text).',
            },
            model: {
              type: 'string',
              description: 'Override OpenAI model (default: gpt-4o).',
            },
          },
          required: ['image_url'],
        },
      },
      {
        name: TOOL_CODE,
        description:
          'LLM-as-judge for code snippets. Scores 1-10 on { correctness, style, safety, intent_match }. Defaults to gpt-4o-mini (cheap). Deterministic (temperature=0, seed=42; ADR-0018). Returns { scores, reasoning, raw_response, overall (0-100), needs_review }.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Source code to grade (any language).',
            },
            criteria: {
              type: 'string',
              description: 'Optional extra grading criteria / intent.',
            },
            model: {
              type: 'string',
              description: 'Override OpenAI model (default: gpt-4o-mini).',
            },
          },
          required: ['code'],
        },
      },
    ],
  };
});

function getClient(): ChatLikeClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY env var is required for mcp-llm-judge');
  }
  return new OpenAI({ apiKey }) as unknown as ChatLikeClient;
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    if (req.params.name === TOOL_VISUAL) {
      const result = await judgeVisual(getClient(), {
        image_url: String(args.image_url ?? ''),
        criteria: typeof args.criteria === 'string' ? args.criteria : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    }
    if (req.params.name === TOOL_CODE) {
      const result = await judgeCode(getClient(), {
        code: String(args.code ?? ''),
        criteria: typeof args.criteria === 'string' ? args.criteria : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    }
    throw new Error(`Unknown tool: ${req.params.name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: msg }, null, 2) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[mcp-llm-judge] ready on stdio\n');
}

main().catch((err) => {
  process.stderr.write(
    `[mcp-llm-judge] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
