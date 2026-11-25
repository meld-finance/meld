import { z } from 'zod';

/** Status and non-secret metadata for Meld's opt-in read-only MCP server. */
export const McpStatus = z.object({
  enabled: z.boolean(),
  hasToken: z.boolean(),
  tokenMask: z.string().nullable(),
  tokenCreatedAt: z.string().nullable(),
  /** Controlled by MCP_ENABLED / MCP_TOKEN in .env, so Settings can't edit it. */
  fromEnv: z.boolean(),
  allowRemote: z.boolean(),
  endpointPath: z.string(),
  port: z.number().int(),
});
export type McpStatus = z.infer<typeof McpStatus>;

export const McpConfigUpdate = z.object({
  enabled: z.boolean().optional(),
  allowRemote: z.boolean().optional(),
});
export type McpConfigUpdate = z.infer<typeof McpConfigUpdate>;

export const McpTokenResponse = z.object({
  status: McpStatus,
  /** Plaintext bearer token, returned only when created or rotated. */
  token: z.string(),
});
export type McpTokenResponse = z.infer<typeof McpTokenResponse>;

export type McpUpdateResponse = {
  status: McpStatus;
  /** Returned when enabling generates a first token automatically. */
  token?: string;
};
