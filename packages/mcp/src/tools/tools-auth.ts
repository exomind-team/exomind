import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { parseToolArgs } from '../utils/zod-tool-parse';
import { getAuthResult } from '../utils/mcp-dependencies';

const getAuthStatusArgsSchema = z.object({}).strict();

export function createAuthTools(): Array<{ tool: Tool; handler: (args: Record<string, unknown>) => Promise<unknown> }> {
  const getAuthStatusTool: Tool = {
    name: 'exomind_get_auth_status',
    description: 'Get current authentication status',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };

  return [
    {
      tool: getAuthStatusTool,
      async handler(_args) {
        parseToolArgs(getAuthStatusArgsSchema, _args);
        const auth = getAuthResult();

        if (!auth) {
          return { authenticated: false, mode: 'uninitialized' };
        }

        return {
          authenticated: auth.valid,
          userId: auth.userId,
          mode: auth.valid ? 'remote' : 'local',
        };
      },
    },
  ];
}
