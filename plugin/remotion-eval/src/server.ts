#!/usr/bin/env node
/**
 * mcp-remotion-eval — MCP stdio server exposing tools:
 *
 *   validate_remotion_code(code: string) -> {
 *     ok, errors[], warnings[], transpiled, paramsCount
 *   }
 *
 *   extract_params(code: string) -> {
 *     ok, errors[], parameters[], paramsCount
 *   }
 *
 * Tools are pure / read-only and intended for agent-company TeamLeads
 * doing pre-PR safety checks and the remotion-validator subagent (TM-99).
 *
 * `extract_params` mirrors src/lib/ai/extract-params.ts (ADR-0002) — see
 * src/extract.ts for the port. Out of scope: lint_adr_compliance,
 * dry-run render budget. Tracked as follow-ups.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { validateRemotionCode } from './validate.js';
import { extractParamsTool } from './extract.js';

const TOOL_VALIDATE = 'validate_remotion_code';
const TOOL_EXTRACT = 'extract_params';

const server = new Server(
  {
    name: 'mcp-remotion-eval',
    version: '0.2.0',
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
        name: TOOL_VALIDATE,
        description:
          'Validate LLM-generated Remotion component code: runs the in-app deny-list (eval/fetch/timers/etc.), structural checks (PARAMS const + PascalCase component per ADR-0002), and a sucrase TS+JSX transpile. Returns { ok, errors, warnings, transpiled, paramsCount }.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'Raw TS/TSX source for a Remotion component (with PARAMS export).',
            },
          },
          required: ['code'],
        },
      },
      {
        name: TOOL_EXTRACT,
        description:
          'Extract the customize-UI parameter schema from a Remotion component (ADR-0002 PARAMS auto-extract). Parses `const PARAMS = { ... }` and per-line `// type: …` annotations (range/color/text/boolean/select/icon/image/font with optional min/max/unit/options/sequence/regen_prompt). Returns { ok, errors, parameters, paramsCount }.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'Raw TS/TSX source for a Remotion component containing a `const PARAMS = { ... }` block.',
            },
          },
          required: ['code'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments as { code?: unknown } | undefined) ?? {};

  if (req.params.name === TOOL_VALIDATE) {
    const result = validateRemotionCode(args.code);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  if (req.params.name === TOOL_EXTRACT) {
    const result = extractParamsTool(args.code);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  }

  throw new Error(`Unknown tool: ${req.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is reserved for MCP JSON-RPC frames.
  process.stderr.write('[mcp-remotion-eval] ready on stdio (tools: validate_remotion_code, extract_params)\n');
}

main().catch((err) => {
  process.stderr.write(
    `[mcp-remotion-eval] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
