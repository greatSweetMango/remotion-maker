#!/usr/bin/env node
/**
 * mcp-remotion-eval — MCP stdio server exposing a single tool:
 *
 *   validate_remotion_code(code: string) -> {
 *     ok: boolean,
 *     errors: string[],
 *     warnings: string[],
 *     transpiled: string | null,
 *     paramsCount: number
 *   }
 *
 * Scaffold (TM-102). Intended consumers: agent-company TeamLeads doing
 * pre-PR safety checks, and the remotion-validator subagent (TM-99).
 *
 * Larger surface (multi-tool: extract_params, lint_adr_compliance, dry-run
 * render budget) is deliberately out of scope — tracked as follow-ups.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { validateRemotionCode } from './validate.js';

const TOOL_NAME = 'validate_remotion_code';

const server = new Server(
  {
    name: 'mcp-remotion-eval',
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
        name: TOOL_NAME,
        description:
          'Validate LLM-generated Remotion component code: runs the in-app deny-list (eval/fetch/timers/etc.), structural checks (PARAMS const + PascalCase component per ADR-0002), and a sucrase TS+JSX transpile. Returns { ok, errors, warnings, transpiled, paramsCount }.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Raw TS/TSX source for a Remotion component (with PARAMS export).',
            },
          },
          required: ['code'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== TOOL_NAME) {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  const code = (req.params.arguments as { code?: unknown } | undefined)?.code;
  const result = validateRemotionCode(code);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: !result.ok,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is reserved for MCP JSON-RPC frames.
  process.stderr.write('[mcp-remotion-eval] ready on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-remotion-eval] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
