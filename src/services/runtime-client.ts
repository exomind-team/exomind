import type { AgentEnergySnapshot, RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { SessionInfo, CreateSessionRequest, UpdateSessionRequest, QuickActionResponse, SessionMessage, SendMessageInput } from '@/lib/types/session';
import type { ProviderProfileSnapshot } from '@/lib/agent-provider/types';
import type {
  RuntimeCapabilityAgentKind,
  RuntimeCapabilityApiProvider,
  RuntimeTopologyCapabilities,
  RuntimeTopologyResponse,
} from '@/lib/types/runtime-topology';
import {
  buildRuntimeAuthHeaders,
  resolveRuntimeHostBaseUrl,
} from '@/lib/utils/runtime-host-address';

const unauthorizedRuntimeRequestWarnings = new Set<string>();

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
  kind: 'echo' | 'claude_cli' | 'codex_cli' | 'api';
  id?: string;
  name?: string;
  description?: string;
  providerProfile?: ProviderProfileSnapshot;
}

export interface RuntimeDeleteAgentResponse {
  status: string;
  id: string;
}

export interface RuntimePtyAgentInfo {
  id: string;
  name: string;
  session_id?: string | null;
  workdir: string;
  command: string;
  status: string;
  created_at: string;
}

export interface RuntimeRefillEnergyResponse {
  energy: AgentEnergySnapshot;
  revived: boolean;
  tickSpawned: boolean;
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
  type:
    | 'session.started'
    | 'output.delta'
    | 'thinking.delta'
    | 'tool.call'
    | 'tool.result'
    | 'error'
    | 'done';
  content: string;
  sessionId?: string;
  message?: string;
  name?: string;
  payload?: unknown;
  finishReason?: string;
  done: boolean;
}

const DEFAULT_TIMEOUT_MS = 3500;

function buildBaseUrl(host: RuntimeHostRecord): string {
  return resolveRuntimeHostBaseUrl(host);
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

function parseRuntimePtyAgentInfo(value: unknown): RuntimePtyAgentInfo | null {
  if (!isObjectRecord(value)) return null;

  const id = readOptionalString(value, 'id');
  const name = readOptionalString(value, 'name');
  const workdir = readOptionalString(value, 'workdir', 'work_dir');
  const command = readOptionalString(value, 'command');
  const status = readOptionalString(value, 'status');
  const createdAt = readOptionalString(value, 'created_at', 'createdAt');
  if (!id || !name || !workdir || !command || !status || !createdAt) {
    return null;
  }

  const sessionRaw = value.session_id ?? value.sessionId;
  if (sessionRaw !== undefined && sessionRaw !== null && typeof sessionRaw !== 'string') {
    return null;
  }

  const parsed: RuntimePtyAgentInfo = {
    id,
    name,
    workdir,
    command,
    status,
    created_at: createdAt,
  };

  if (sessionRaw === null) {
    parsed.session_id = null;
  } else if (typeof sessionRaw === 'string' && sessionRaw.trim().length > 0) {
    parsed.session_id = sessionRaw;
  }

  return parsed;
}

function readOptionalString(
  record: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey?: string,
): string | undefined {
  const snakeValue = record[snakeCaseKey];
  if (typeof snakeValue === 'string' && snakeValue) {
    return snakeValue;
  }

  if (!camelCaseKey) return undefined;
  const camelValue = record[camelCaseKey];
  return typeof camelValue === 'string' && camelValue ? camelValue : undefined;
}

function parseStringUnionArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return null;
    }
    if (!allowed.includes(item as T)) {
      return null;
    }
    parsed.push(item as T);
  }
  return parsed;
}

function parseTopologyCapabilities(value: unknown): RuntimeTopologyCapabilities | null {
  if (!isObjectRecord(value)) return null;

  const agentKinds = parseStringUnionArray<RuntimeCapabilityAgentKind>(
    value.agent_kinds,
    ['claude_cli', 'codex_cli', 'api'],
  );
  const apiProviders = parseStringUnionArray<RuntimeCapabilityApiProvider>(
    value.api_providers,
    ['openai', 'anthropic'],
  );

  if (!agentKinds || !apiProviders) {
    return null;
  }

  return {
    agent_kinds: agentKinds,
    api_providers: apiProviders,
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
  const capabilities = parseTopologyCapabilities(value.capabilities);
  if (!capabilities) return null;

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
    capabilities,
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

function normalizeProviderProfileForWire(profile: ProviderProfileSnapshot): Record<string, unknown> {
  return {
    profile_id: profile.profileId,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    base_url: profile.baseUrl,
    api_key: profile.apiKey,
  };
}

function normalizeCreateAgentRequest(request: RuntimeCreateAgentRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    kind: request.kind,
  };

  if (request.id) payload.id = request.id;
  if (request.name) payload.name = request.name;
  if (request.description) payload.description = request.description;

  if (request.kind === 'api') {
    if (!request.providerProfile) {
      throw new Error('providerProfile is required for api agent（API Agent 必须提供 providerProfile）');
    }
    payload.provider_profile = normalizeProviderProfileForWire(request.providerProfile);
  }

  return payload;
}

function parseTypedRuntimeAgentConversationChunk(
  parsed: Record<string, unknown>,
): RuntimeAgentConversationChunk | null {
  const rawType = typeof parsed.type === 'string' ? parsed.type : '';
  const sessionId = readOptionalString(parsed, 'session_id', 'sessionId');
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  const finishReason = readOptionalString(parsed, 'finish_reason', 'finishReason');
  const message = readOptionalString(parsed, 'message');

  switch (rawType) {
    case 'session.started':
      if (!sessionId) return null;
      return {
        type: 'session.started',
        content: '',
        sessionId,
        done: false,
      };
    case 'output.delta':
      return {
        type: 'output.delta',
        content,
        sessionId,
        done: false,
      };
    case 'thinking.delta':
      return {
        type: 'thinking.delta',
        content,
        sessionId,
        done: false,
      };
    case 'tool.call': {
      const name = readOptionalString(parsed, 'name');
      if (!name) return null;
      return {
        type: 'tool.call',
        name,
        payload: parsed.payload,
        content,
        sessionId,
        done: false,
      };
    }
    case 'tool.result': {
      const name = readOptionalString(parsed, 'name');
      if (!name) return null;
      return {
        type: 'tool.result',
        name,
        payload: parsed.payload,
        content,
        sessionId,
        done: false,
      };
    }
    case 'error':
      return {
        type: 'error',
        content,
        sessionId,
        message: message ?? content,
        done: false,
      };
    case 'done':
      return {
        type: 'done',
        content: '',
        sessionId,
        finishReason,
        done: true,
      };
    default:
      return null;
  }
}

function parseRuntimeAgentConversationChunks(data: string): RuntimeAgentConversationChunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  if (!isObjectRecord(parsed)) return [];

  const typedChunk = parseTypedRuntimeAgentConversationChunk(parsed);
  if (typedChunk) {
    return [typedChunk];
  }

  const content = typeof parsed.content === 'string' ? parsed.content : '';
  const sessionId = readOptionalString(parsed, 'session_id', 'sessionId');

  if (!content && !sessionId) return [];

  if (!content && sessionId) {
    return [{
      type: 'session.started',
      content: '',
      sessionId,
      done: false,
    }];
  }

  return [{
    type: 'output.delta',
    content,
    sessionId,
    done: false,
  }];
}

export class RuntimeClient {
  private readonly fetchImpl: RuntimeFetch;
  private readonly timeoutMs: number;

  constructor(options: RuntimeClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getAgents(host: RuntimeHostRecord): Promise<RuntimeClientResult<RuntimeAgentSummary[]>> {
    const response = await this.getJson(`${buildBaseUrl(host)}/agents`, host.authToken);
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
    const response = await this.getJson(`${buildBaseUrl(host)}/topology`, host.authToken);
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
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/agents`,
      'POST',
      normalizeCreateAgentRequest(request),
      host.authToken,
    );
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
      undefined,
      host.authToken,
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

  async stopPtyAgent(
    host: RuntimeHostRecord,
    ptyId: string,
  ): Promise<RuntimeClientResult<RuntimePtyAgentInfo>> {
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/pty/${encodeURIComponent(ptyId)}/stop`,
      'POST',
      undefined,
      host.authToken,
    );
    if (!response.ok) {
      return response;
    }

    const parsed = parseRuntimePtyAgentInfo(response.data);
    if (!parsed) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid stop pty payload（停止 PTY 响应格式无效）',
        },
      };
    }

    return {
      ok: true,
      data: parsed,
    };
  }

  async getAllEnergy(
    host: RuntimeHostRecord,
  ): Promise<RuntimeClientResult<AgentEnergySnapshot[]>> {
    const response = await this.getJson(`${buildBaseUrl(host)}/energy`, host.authToken);
    if (!response.ok) {
      return response;
    }

    if (!Array.isArray(response.data)) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid /energy payload（/energy 响应格式无效）',
        },
      };
    }

    return {
      ok: true,
      data: response.data as AgentEnergySnapshot[],
    };
  }

  async getAgentEnergy(
    host: RuntimeHostRecord,
    agentId: string,
  ): Promise<AgentEnergySnapshot | null> {
    const result = await this.getJson(
      `${buildBaseUrl(host)}/agents/${encodeURIComponent(agentId)}/energy`,
      host.authToken,
    );
    if (!result.ok) return null;
    const data = result.data;
    if (!isObjectRecord(data)) return null;
    return data as unknown as AgentEnergySnapshot;
  }

  async refillEnergy(
    host: RuntimeHostRecord,
    agentId: string,
    amount: number,
  ): Promise<RuntimeClientResult<RuntimeRefillEnergyResponse>> {
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/agents/${encodeURIComponent(agentId)}/energy/refill`,
      'POST',
      { amount },
      host.authToken,
    );
    if (!response.ok) {
      return response;
    }

    if (!isObjectRecord(response.data) || !isObjectRecord(response.data.energy)) {
      return {
        ok: false,
        error: {
          code: 'invalid_payload',
          message: 'invalid refill energy payload（充能响应格式无效）',
        },
      };
    }

    return {
      ok: true,
      data: {
        energy: response.data.energy as unknown as AgentEnergySnapshot,
        revived: response.data.revived === true,
        tickSpawned: response.data.tick_spawned === true,
      },
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
        headers: Object.fromEntries(buildRuntimeAuthHeaders(host.authToken, {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        }).entries()),
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

          const chunks = parseRuntimeAgentConversationChunks(data);
          for (const chunk of chunks) {
            yield chunk;
          }
        }
      }

      buffer += decoder.decode();
      const trailingData = extractSseData(buffer);
      if (!trailingData || trailingData === '[DONE]') return;

      const trailingChunks = parseRuntimeAgentConversationChunks(trailingData);
      for (const trailingChunk of trailingChunks) {
        yield trailingChunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Session CRUD API ─────────────────────────────────────────

  async listSessions(
    host: RuntimeHostRecord,
    status?: string,
  ): Promise<RuntimeClientResult<SessionInfo[]>> {
    const params = status ? `?status=${encodeURIComponent(status)}` : '';
    const response = await this.getJson(`${buildBaseUrl(host)}/sessions${params}`, host.authToken);
    if (!response.ok) return response;
    if (!Array.isArray(response.data)) {
      return {
        ok: false,
        error: { code: 'invalid_payload', message: 'invalid /sessions payload' },
      };
    }
    return { ok: true, data: response.data as SessionInfo[] };
  }

  async getSession(
    host: RuntimeHostRecord,
    sessionId: string,
  ): Promise<RuntimeClientResult<SessionInfo>> {
    const response = await this.getJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(sessionId)}`,
      host.authToken,
    );
    if (!response.ok) return response;
    return { ok: true, data: response.data as SessionInfo };
  }

  async createSession(
    host: RuntimeHostRecord,
    request: CreateSessionRequest,
  ): Promise<RuntimeClientResult<SessionInfo>> {
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/sessions`,
      'POST',
      request,
      host.authToken,
    );
    if (!response.ok) return response;
    return { ok: true, data: response.data as SessionInfo };
  }

  async updateSession(
    host: RuntimeHostRecord,
    sessionId: string,
    request: UpdateSessionRequest,
  ): Promise<RuntimeClientResult<SessionInfo>> {
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(sessionId)}`,
      'PATCH',
      request,
      host.authToken,
    );
    if (!response.ok) return response;
    return { ok: true, data: response.data as SessionInfo };
  }

  async deleteSession(
    host: RuntimeHostRecord,
    sessionId: string,
  ): Promise<RuntimeClientResult<SessionInfo>> {
    const response = await this.sendJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(sessionId)}`,
      'DELETE',
      undefined,
      host.authToken,
    );
    if (!response.ok) return response;
    return { ok: true, data: response.data as SessionInfo };
  }

  async submitQuickAction(
    host: RuntimeHostRecord,
    sessionId: string,
    response: QuickActionResponse,
  ): Promise<RuntimeClientResult<SessionInfo>> {
    const result = await this.sendJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(sessionId)}/quick-action`,
      'POST',
      response,
      host.authToken,
    );
    if (!result.ok) return result;
    return { ok: true, data: result.data as SessionInfo };
  }

  async markSessionWaiting(
    host: RuntimeHostRecord,
    sessionId: string,
  ): Promise<RuntimeClientResult<SessionInfo>> {
    const result = await this.sendJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(sessionId)}/mark-waiting`,
      'POST',
      undefined,
      host.authToken,
    );
    if (!result.ok) return result;
    return { ok: true, data: result.data as SessionInfo };
  }

  async listChildSessions(
    host: RuntimeHostRecord,
    parentSessionId: string,
  ): Promise<RuntimeClientResult<SessionInfo[]>> {
    const result = await this.getJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(parentSessionId)}/children`,
      host.authToken,
    );
    if (!result.ok) return result;
    return { ok: true, data: result.data as SessionInfo[] };
  }

  async sendSessionMessage(
    host: RuntimeHostRecord,
    sessionId: string,
    input: SendMessageInput,
  ): Promise<RuntimeClientResult<SessionMessage>> {
    const result = await this.sendJson(
      `${buildBaseUrl(host)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      'POST',
      input,
      host.authToken,
    );
    if (!result.ok) return result;
    return { ok: true, data: result.data as SessionMessage };
  }

  private async getJson(url: string, authToken?: string): Promise<RuntimeClientResult<unknown>> {
    return this.sendJson(url, 'GET', undefined, authToken);
  }

  private async sendJson(
    url: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    payload?: unknown,
    authToken?: string,
  ): Promise<RuntimeClientResult<unknown>> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: Object.fromEntries(
          buildRuntimeAuthHeaders(
            authToken,
            payload != null ? { 'Content-Type': 'application/json' } : undefined,
          ).entries(),
        ),
        body: payload != null ? JSON.stringify(payload) : undefined,
        signal: controller?.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          const warningKey = `${method}|${url}|${authToken ? 'with-token' : 'without-token'}`;
          if (!unauthorizedRuntimeRequestWarnings.has(warningKey)) {
            unauthorizedRuntimeRequestWarnings.add(warningKey);
            console.warn('[runtime-client][auth] unauthorized runtime request', {
              method,
              url,
              authTokenPresent: Boolean(authToken),
            });
          }
        }
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
