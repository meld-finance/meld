import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createChatTools, runTool, toToolJsonSchema } from '../ai/chat-tools';
import type { Db } from '../db/client';
import { MCP_PROMPTS, MCP_RESOURCES, readMcpResource, renderMcpPrompt } from './resources';

const MCP_INSTRUCTIONS =
  'Read-only access to the user’s personal Meld financial data. Account/policy numbers are masked and estate contact details are omitted. Read `meld://conventions` or domain docs (`meld://docs/retirement`, `meld://docs/tax`, `meld://docs/recurring`) when interpreting nuanced fields.';

/** Builds a fresh read-only MCP Server instance backed by Meld's shared financial tools. */
export function createMeldMcpServer(db: Db, version = '0.0.0'): Server {
  const tools = createChatTools(db);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: 'meld', version },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: MCP_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: {
        type: 'object' as const,
        ...toToolJsonSchema(t.input),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await runTool(toolsByName.get(req.params.name), req.params.arguments ?? {});
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: MCP_RESOURCES,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const resource = await readMcpResource(db, req.params.uri);
    if (!resource) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${req.params.uri}`);
    }
    return {
      contents: [resource],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: MCP_PROMPTS,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = renderMcpPrompt(req.params.name, req.params.arguments);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${req.params.name}`);
    }
    return prompt;
  });

  return server;
}
