import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  toRuntimeBaseUrl,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type {
  ApiAgentSessionRecord,
  ApiAgentTurnItem,
  RunApiAgentSessionInput,
} from '@/lib/types/agent-session';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

interface RuntimeAgentToolCallPayload {
  id: string;
  name: string;
  input: unknown;
}

interface RuntimeAssistantTurnPayload {
  content: string;
  toolCalls?: RuntimeAgentToolCallPayload[];
}

interface RuntimeAgentToolCallRecordPayload {
  toolName: string;
  input: unknown;
  output?: string;
}

interface RuntimeAgentSessionRecordPayload {
  sessionId: string;
  triggerSource: string;
  provider: string;
  model: string;
  prompt?: string | null;
  content: string;
  assistantTurn: RuntimeAssistantTurnPayload;
  toolCalls: RuntimeAgentToolCallRecordPayload[];
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  completedAt: string;
}

export interface AgentSessionRtAdapterOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
  timeoutMs?: number;
}

export class AgentSessionRtError extends Error {
  readonly status: number;
  readonly responseBody?: string;

  constructor(message: string, status: number, responseBody?: string) {
    super(message);
    this.name = 'AgentSessionRtError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

const AGENT_SESSION_API_BASE_PATH = '/agent-sessions';
const DEFAULT_AGENT_SESSION_RT_TIMEOUT_MS = 10_000;

function normalizeTurnHistory(history: RunApiAgentSessionInput['history']): ApiAgentTurnItem[] {
  return (history ?? []).map((item) => {
    if (item.role === 'assistant') {
      return {
        role: 'assistant',
        content: item.content,
        toolCalls: item.toolCalls ?? [],
      } as const;
    }
    return item;
  });
}

function normalizeSessionRecord(
  payload: RuntimeAgentSessionRecordPayload,
): ApiAgentSessionRecord {
  return {
    sessionId: payload.sessionId,
    triggerSource: payload.triggerSource,
    provider: payload.provider,
    model: payload.model,
    ...(payload.prompt ? { prompt: payload.prompt } : {}),
    content: payload.content,
    assistantTurn: {
      content: payload.assistantTurn?.content ?? '',
      toolCalls: payload.assistantTurn?.toolCalls ?? [],
    },
    toolCalls: payload.toolCalls ?? [],
    status: payload.status,
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
    createdAt: payload.createdAt,
    completedAt: payload.completedAt,
  };
}

function toRuntimeRequestPayload(input: RunApiAgentSessionInput): Record<string, unknown> {
  return {
    ...(input.providerProfile
      ? {
          providerProfile: {
            provider: input.providerProfile.provider,
            model: input.providerProfile.model,
            ...(input.providerProfile.baseUrl
              ? { baseUrl: input.providerProfile.baseUrl }
              : {}),
            apiKey: input.providerProfile.apiKey,
          },
        }
      : {}),
    ...(input.systemPrompt?.trim()
      ? { systemPrompt: input.systemPrompt.trim() }
      : {}),
    tools: input.tools ?? [],
    presets: input.presets ?? [],
    ...(input.scopeKey?.trim() ? { scopeKey: input.scopeKey.trim() } : {}),
    history: normalizeTurnHistory(input.history),
    ...(input.newUserMessage?.trim()
      ? { newUserMessage: input.newUserMessage.trim() }
      : {}),
  };
}

export class AgentSessionRtAdapter {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;
  private readonly timeoutMs: number;

  constructor(options: AgentSessionRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_SESSION_RT_TIMEOUT_MS;
  }

  async runSession(input: RunApiAgentSessionInput): Promise<ApiAgentSessionRecord> {
    const payload = await this.requestJson<RuntimeAgentSessionRecordPayload>(
      AGENT_SESSION_API_BASE_PATH,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(toRuntimeRequestPayload(input)),
      },
    );
    return normalizeSessionRecord(payload);
  }

  async getSession(sessionId: string): Promise<ApiAgentSessionRecord | null> {
    const target = this.resolveTarget();
    const response = await this.fetchWithTimeout(
      this.url(`${AGENT_SESSION_API_BASE_PATH}/${encodeURIComponent(sessionId)}`, target),
      {
        method: 'GET',
        headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await this.toRtError(
        response,
        `RT agent session get failed: ${response.status}（获取 API Agent 会话失败）`,
      );
    }
    return normalizeSessionRecord(await response.json() as RuntimeAgentSessionRecordPayload);
  }

  private async requestJson<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchWithTimeout(this.url(path, target), {
      ...init,
      headers: buildRuntimeAuthHeaders(target, init?.headers),
    });
    if (!response.ok) {
      throw await this.toRtError(
        response,
        `RT agent session request failed: ${response.status}（API Agent 会话请求失败）`,
      );
    }
    return await response.json() as T;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async toRtError(response: Response, message: string): Promise<AgentSessionRtError> {
    let responseBody: string | undefined;
    try {
      responseBody = await response.text();
    } catch {
      responseBody = undefined;
    }
    return new AgentSessionRtError(message, response.status, responseBody);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${toRuntimeBaseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}
