import type { ProviderProfileSnapshot } from '@/lib/agent-provider/types';

export interface ApiAgentToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ApiAgentToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ApiAgentAssistantTurn {
  content: string;
  toolCalls: ApiAgentToolCall[];
}

export interface ApiAgentToolCallRecord {
  toolName: string;
  input: unknown;
  output?: string;
}

export type ApiAgentSessionStatus = 'needs_tool_calls' | 'completed' | string;

export type ApiAgentTurnItem =
  | {
      role: 'user';
      content: string;
    }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ApiAgentToolCall[];
    }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      content: string;
    };

export interface RunApiAgentSessionInput {
  providerProfile?: ProviderProfileSnapshot | null;
  systemPrompt?: string;
  tools?: ApiAgentToolDefinition[];
  presets?: string[];
  scopeKey?: string;
  history?: ApiAgentTurnItem[];
  newUserMessage?: string;
}

export interface ApiAgentSessionRecord {
  sessionId: string;
  triggerSource: string;
  provider: string;
  model: string;
  prompt?: string;
  content: string;
  assistantTurn: ApiAgentAssistantTurn;
  toolCalls: ApiAgentToolCallRecord[];
  status: ApiAgentSessionStatus;
  errorMessage?: string;
  createdAt: string;
  completedAt: string;
}
