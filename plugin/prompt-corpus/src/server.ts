#!/usr/bin/env node
/**
 * mcp-prompt-corpus — MCP stdio server exposing two tools (TM-105):
 *
 *   get_corpus(name) → { name, description, prompts: [{id, category, prompt}] }
 *   list_corpora()   → { names: string[] }
 *
 * Why: nightly bench (TM-83) and regression (TM-85) runs both need a
 * single source-of-truth for prompt sets. Embedding the lists inline in
 * each bench script caused drift (TM-46 r6 vs r7 mismatch). This server
 * exposes the canonical corpora so any teammate / Orchestrator script
 * can fetch the same payload.
 *
 * Corpora live in `corpora/*.json` next to this package. The server is
 * read-only — to update a corpus, edit JSON in a PR.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createFsStore, defaultCorpusRoot, type CorpusStore } from './corpus.js';

const TOOL_GET = 'get_corpus';
const TOOL_LIST = 'list_corpora';

const server = new Server(
  {
    name: 'mcp-prompt-corpus',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: TOOL_LIST,
        description:
          'List the names of every prompt corpus available on this server. Returns `{ names: string[] }`. Static set; corpora are added via PR.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: TOOL_GET,
        description:
          'Fetch a prompt corpus by name. Returns `{ name, description, prompts: [{id, category, prompt}] }` where category ∈ {character, motion-graphics, data-viz, typography} (TM-83/TM-85 axes). Throws if the corpus does not exist.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Corpus identifier — e.g. "tm-83-smoke" or "tm-85-regression".',
            },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    ],
  };
});

function getStore(): CorpusStore {
  const root = process.env.PROMPT_CORPUS_ROOT || defaultCorpusRoot(import.meta.url);
  return createFsStore(root);
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    if (req.params.name === TOOL_LIST) {
      const names = await getStore().list();
      return {
        content: [{ type: 'text', text: JSON.stringify({ names }, null, 2) }],
        isError: false,
      };
    }
    if (req.params.name === TOOL_GET) {
      const name = typeof args.name === 'string' ? args.name : '';
      if (!name) throw new Error('name is required');
      const corpus = await getStore().get(name);
      return {
        content: [{ type: 'text', text: JSON.stringify(corpus, null, 2) }],
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
  process.stderr.write('[mcp-prompt-corpus] ready on stdio\n');
}

main().catch((err) => {
  process.stderr.write(
    `[mcp-prompt-corpus] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
