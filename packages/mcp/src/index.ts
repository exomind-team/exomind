/**
 * ExoMind MCP Server
 *
 * Model Context Protocol Server for ExoMind
 * Provides tools for EventLog and TimeBlock management
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import tools
import { createEventTools } from './tools/event-tools.js';
import { createBlockTools } from './tools/block-tools.js';

class ExoMindMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'exomind-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: 'ExoMind MCP Server - Manage events and time blocks',
      }
    );

    this.setupTools();
  }

  private setupTools() {
    const eventTools = createEventTools();
    const blockTools = createBlockTools();
    const allTools = [...eventTools, ...blockTools];

    // Register list tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: allTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Register call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = allTools.find((t) => t.name === name);
      if (!tool) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Unknown tool "${name}"`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await tool.handler(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ExoMind MCP Server started');
  }
}

// Start the server
const server = new ExoMindMCPServer();
server.start().catch(console.error);
