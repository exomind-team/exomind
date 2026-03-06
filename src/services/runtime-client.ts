import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { RuntimeTopologyResponse } from '@/lib/types/runtime-topology';

export type RuntimeClientErrorCode = 'timeout' | 'network' | 'http' | 'invalid_payload';

export interface RuntimeClientError {
  code: RuntimeClientErrorCode;
  message: string;
  status?: number;
}

export type RuntimeClientResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: RuntimeClientError;
    };

export interface RuntimeAgentSummary {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface RuntimeCreateAgentRequest {
  kind: 'echo' | 'claude';
  id?: string;
  name?: string;
  description?: string;
}

export interface RuntimeDeleteAgentResponse {
  status: string;
  id: string;
}

type RuntimeFetch = typeof fetch;

export interface RuntimeClientOptions {
  fetchImpl?: RuntimeFetch;
  timeoutMs?: number;
}

export interface RuntimeAgentConversationRequest {
  agentId: string;
  message: string;
  sessionId?: string;
}

export interface RuntimeAgentConversationChunk {
  content: string;
  sessionId?: string;
}

const DEFAULT_TIMEOUT_MS = 3500;

function buildBaseUrl(host: RuntimeHostRecord): string {
  return `http://${host.host}:${host.port}`;
}

function buildAgentChatUrl(host: RuntimeHostRecord, agentId: string): string {
  return `${buildBaseUrl(host)}/agents/${encodeURIComponent(agentId)}/chat`;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('aborterror')
    || message.includes('aborted')
    || message.includes('timeout')
    || message.includes('signal is aborted')
  );
}

function toNetworkError(error: unknown): RuntimeClientError {
  if (isTimeoutError(error)) {
    return {
      code: 'timeout',
      message: 'request timeout（请求超时）',
    };
  }
  return {
    code: 'network',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRuntimeAgentSummary(value: unknown): RuntimeAgentSummary | null {
  if (!isObjectRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.name !== 'string') return null;

  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : '',
    status: typeof value.status === 'string' ? value.status : 'unknown',
  };
}

function parseTopologyResponse(value: unknown): RuntimeTopologyResponse | null {
  if (!isObjectRecord(value)) return null;
  if (value.host_id != null && typeof value.host_id !== 'string') return null;
  if (typeof value.hostname !== 'string') return null;
  if (typeof value.os !== 'string') return null;
  if (typeof value.arch !== 'string') return null;
  if (typeof value.uptime_secs !== 'number') return null;
  if (typeof value.version !== 'string') return null;
  if (typeof value.port !== 'number') return null;
  if (value.total_memory_mb != null && typeof value.total_memory_mb !== 'number') return null;
  if (value.used_memory_mb != null && typeof value.used_memory_mb !== 'number') return null;

  return {
    host_id: typeof value.host_id === 'string' ? value.host_id : undefined,
    hostname: value.hostname,
    os: value.os,
    arch: value.arch,
    uptime_secs: value.uptime_secs,
    version: value.version,
    port: value.port,
    total_memory_mb: typeof value.total_memory_mb === 'number' ? value.total_memory_mb : undefined,
    used_memory_mb: typeof value.used_memory_mb === 'number' ? value.used_memory_mb : undefined,
  };
}

function extractSseData(rawEvent: string): string | null {
  const chunks: string[] = [];
  for (const rawLine of rawEvent.split(/\r?\n/)) {
    if (!rawLine.startsWith('data:')) continue;
    chunks.push(rawLine.slice(5).trim());
  }

  if (chunks.length === 0) return null;
  return chunks.join('\n');
}

function parseRuntimeAgentConversationChunk(data: string): RuntimeAgentConversationChunk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isObjectRecord(parsed)) return null;

  const content = typeof parsed.content === 'string' ? parsed.content : '';
  const sessionId = typeof parsed.session_id === 'string' && parsed.session_id
    ? parsed.session_id
    : undefined;

  if (!content && !sessionId) return null;

  return { content, sessionId };
}

export class RuntimeClient {
  private readonly fetchImpl: RuntimeFetch;
  private readonly timeoutMs: number;

  constructor(options: RuntimeClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getAgents(host: RuntimeHostRecord): Promise<RuntimeClientResult<RuntimeAgentSummary[]>> {
    const response = await this.getJson(`${buildBaseUrl(host)}/agents`);
    if (!response.ok) {
      return response;
    }

    if (!Array.isArray(response.data)) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid /agents payload（/agents 响应格式无效）',
        },
      };
    }

    const agents: RuntimeAgentSummary[] = [];
    for (const item of response.data) {
      const parsed = parseRuntimeAgentSummary(item);
      if (!parsed) {
        return {
          ok: false,
          error: {
            code: 'invalid_payload',
            message: 'invalid agent item（agent 条目格式无效）',
          },
        };
      }
      agents.push(parsed);
    }

    return {
      ok: true,
      data: agents,
    };
  }

  async getTopology(host: RuntimeHostRecord): Promise<RuntimeClientResult<RuntimeTopologyResponse>> {
    const response = await this.getJson(`${buildBaseUrl(host)}/topology`);
    if (!response.ok) {
      return response;
    }

    const parsed = parseTopologyResponse(response.data);
    if (!parsed) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid /topology payload（/topology 响应格式无效）',
        },
      };
    }

    return {
      ok: true,
      data: parsed,
    };
  }

  async createAgent(
    host: RuntimeHostRecord,
    request: RuntimeCreateAgentRequest,
  ): Promise<RuntimeClientResult<RuntimeAgentSummary>> {
    const response = await this.sendJson(`${buildBaseUrl(host)}/agents`, 'POST', request);
    if (!response.ok) {
      return response;
    }

    const parsed = parseRuntimeAgentSummary(response.data);
    if (!parsed) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid create agent payload（创建 Agent 响应格式无效）',
        },
      };
    }

    return {
      ok: true,
      data: parsed,
    };
  }

  async deleteAgent(
    host: RuntimeHostRecord,
    agentId: string,
  ): Promise<RuntimeClientResult<RuntimeDeleteAgentResponse>> {
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/agents/${encodeURIComponent(agentId)}`,
      'DELETE',
    );
    if (!response.ok) {
      return response;
    }

    if (!isObjectRecord(response.data)) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid delete agent payload（删除 Agent 响应格式无效）',
        },
      };
    }

    const status = typeof response.data.status === 'string' ? response.data.status : '';
    const id = typeof response.data.id === 'string' ? response.data.id : '';
    if (!status || !id) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid delete agent payload（删除 Agent 响应格式无效）',
        },
      };
    }

    return {
      ok: true,
      data: { status, id },
    };
  }

  async *streamAgentConversation(
    host: RuntimeHostRecord,
    request: RuntimeAgentConversationRequest,
  ): AsyncGenerator<RuntimeAgentConversationChunk, void, void> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    let response: Response;
    try {
      response = await this.fetchImpl(buildAgentChatUrl(host, request.agentId), {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: request.message,
          session_id: request.sessionId,
        }),
        signal: controller?.signal,
      });
    } catch (error) {
      if (timer) {
        clearTimeout(timer);
      }
      const networkError = toNetworkError(error);
      throw new Error(networkError.message);
    }

    if (timer) {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('empty chat stream body（聊天流响应体为空）');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';

        for (const event of events) {
          const data = extractSseData(event);
          if (!data) continue;
          if (data === '[DONE]') return;

          const chunk = parseRuntimeAgentConversationChunk(data);
          if (chunk) {
            yield chunk;
          }
        }
      }

      buffer += decoder.decode();
      const trailingData = extractSseData(buffer);
      if (!trailingData || trailingData === '[DONE]') return;

      const trailingChunk = parseRuntimeAgentConversationChunk(trailingData);
      if (trailingChunk) {
        yield trailingChunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async getJson(url: string): Promise<RuntimeClientResult<unknown>> {
    return this.sendJson(url, 'GET');
  }

  private async sendJson(
    url: string,
    method: 'GET' | 'POST' | 'DELETE',
    payload?: unknown,
  ): Promise<RuntimeClientResult<unknown>> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: payload != null ? { 'Content-Type': 'application/json' } : undefined,
        body: payload != null ? JSON.stringify(payload) : undefined,
        signal: controller?.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: 'http',
            message: `HTTP ${response.status}`,
            status: response.status,
          },
        };
      }

      const data = await response.json();
      return {
        ok: true,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        error: toNetworkError(error),
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
