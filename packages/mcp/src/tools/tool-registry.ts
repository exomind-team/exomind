import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createEventTools } from './tools-event';
import { createTimeBlockTools } from './tools-timeblock';
import type { McpToolDependencies } from '../utils/mcp-dependencies';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  tool: Tool;
  handler: ToolHandler;
}

export async function createToolRegistry(): Promise<{
  listTools(): Tool[];
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}> {
  const { createMcpToolDependencies } = await import('../utils/mcp-dependencies');
  return createToolRegistryWithDependencies(createMcpToolDependencies());
}

export function createToolRegistryWithDependencies(dependencies: McpToolDependencies): {
  listTools(): Tool[];
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
} {
  const registry = new Map<string, RegisteredTool>();

  for (const entry of [
    ...createEventTools(dependencies.eventLogService),
    ...createTimeBlockTools(dependencies.timeBlockService),
  ]) {
    registry.set(entry.tool.name, entry);
  }

  return {
    listTools() {
      return [...registry.values()].map((entry) => entry.tool);
    },
    async callTool(name, args) {
      const entry = registry.get(name);
      if (!entry) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }),
            },
          ],
        };
      }

      try {
        const result = await entry.handler(args);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
        };
      }
    },
  };
}
