import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createToolRegistry } from './tools/tool-registry';
import { initMcpWithAuth } from './utils/mcp-dependencies';

export async function startExoMindMcpServer(): Promise<void> {
  // 启动时验证用户凭据
  try {
    const auth = await initMcpWithAuth();
    if (auth.valid) {
      console.error(`[MCP] Authenticated as: ${auth.userId}`);
    } else {
      console.error(`[MCP] Running in local mode: ${auth.reason}`);
    }
  } catch (error) {
    console.error('[MCP] Authentication failed:', error);
    process.exit(1);
  }

  const toolRegistry = await createToolRegistry();

  const server = new Server(
    { name: 'exomind-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolRegistry.listTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const rawArguments = request.params.arguments;
    const toolArguments =
      rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
        ? (rawArguments as Record<string, unknown>)
        : {};
    return toolRegistry.callTool(toolName, toolArguments);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANT: use stderr for logs; stdout is reserved for MCP transport.
  console.error('ExoMind MCP Server started');
}
