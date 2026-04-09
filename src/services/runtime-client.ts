import type { AgentEnergySnapshot, RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { SessionInfo, CreateSessionRequest, UpdateSessionRequest, QuickActionResponse, SessionMessage, SendMessageInput } from '@/lib/types/session';
import type { ProviderProfileSnapshot } from '@/lib/agent-provider/types';
import type {
  RuntimeCapabilityAgentKind,
  RuntimeCapabilityApiProvider,
  RuntimeTopologyCapabilities,
  RuntimeTopologyDevice,
  RuntimeTopologyDeviceComponent,
  RuntimeTopologyDeviceKind,
  RuntimeTopologyDeviceLink,
  RuntimeTopologyResponse,
  RuntimeTopologyRuntimeHost,
} from '@/lib/types/runtime-topology';
import { normalizeRuntimeTopologyResponse } from '@/lib/types/runtime-topology';
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
const PTY_STOP_TIMEOUT_MS = 10000;

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

function readOptionalNumber(
  record: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey?: string,
): number | undefined {
  const snakeValue = record[snakeCaseKey];
  if (typeof snakeValue === 'number' && Number.isFinite(snakeValue)) {
    return snakeValue;
  }

  if (!camelCaseKey) return undefined;
  const camelValue = record[camelCaseKey];
  return typeof camelValue === 'number' && Number.isFinite(camelValue) ? camelValue : undefined;
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

function parseTopologyDeviceKind(value: unknown): RuntimeTopologyDeviceKind | null {
  if (typeof value !== 'string') return null;
  const allowedKinds: RuntimeTopologyDeviceKind[] = [
    'desktop',
    'laptop',
    'phone',
    'server',
    'embedded',
    'wearable',
    'unknown',
  ];
  return allowedKinds.includes(value as RuntimeTopologyDeviceKind)
    ? value as RuntimeTopologyDeviceKind
    : 'unknown';
}

function parseTopologyRuntimeHost(value: unknown): RuntimeTopologyRuntimeHost | null {
  if (!isObjectRecord(value)) return null;

  const hostname = readOptionalString(value, 'hostname');
  const os = readOptionalString(value, 'os');
  const arch = readOptionalString(value, 'arch');
  const version = readOptionalString(value, 'version');
  const uptimeSecs = readOptionalNumber(value, 'uptime_secs', 'uptimeSecs');
  const port = readOptionalNumber(value, 'port');
  const capabilities = parseTopologyCapabilities(value.capabilities);

  if (!hostname || !os || !arch || !version || uptimeSecs == null || port == null || !capabilities) {
    return null;
  }

  return {
    host_id: readOptionalString(value, 'host_id', 'hostId'),
    hostname,
    os,
    arch,
    uptime_secs: uptimeSecs,
    version,
    port,
    total_memory_mb: readOptionalNumber(value, 'total_memory_mb', 'totalMemoryMb'),
    used_memory_mb: readOptionalNumber(value, 'used_memory_mb', 'usedMemoryMb'),
    capabilities,
  };
}

function parseTopologyDevice(value: unknown): RuntimeTopologyDevice | null {
  if (!isObjectRecord(value)) return null;

  const id = readOptionalString(value, 'id');
  const name = readOptionalString(value, 'name');
  const kind = parseTopologyDeviceKind(value.kind);

  if (!id || !name || !kind) {
    return null;
  }

  return {
    id,
    name,
    kind,
    primary_runtime_host_id: readOptionalString(value, 'primary_runtime_host_id', 'primaryRuntimeHostId'),
  };
}

function parseTopologyDeviceComponent(value: unknown): RuntimeTopologyDeviceComponent | null {
  if (!isObjectRecord(value)) return null;

  const id = readOptionalString(value, 'id');
  const deviceId = readOptionalString(value, 'device_id', 'deviceId');
  const kind = readOptionalString(value, 'kind');
  const name = readOptionalString(value, 'name');
  const status = readOptionalString(value, 'status');

  if (!id || !deviceId || !kind || !name || !status) {
    return null;
  }

  return {
    id,
    device_id: deviceId,
    kind,
    name,
    status,
    protocol: readOptionalString(value, 'protocol'),
    runtime_host_id: readOptionalString(value, 'runtime_host_id', 'runtimeHostId'),
  };
}

function parseTopologyDeviceComponentList(value: unknown): RuntimeTopologyDeviceComponent[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: RuntimeTopologyDeviceComponent[] = [];
  for (const item of value) {
    const component = parseTopologyDeviceComponent(item);
    if (!component) {
      return null;
    }
    parsed.push(component);
  }
  return parsed;
}

function parseTopologyDeviceLink(value: unknown): RuntimeTopologyDeviceLink | null {
  if (!isObjectRecord(value)) return null;

  const id = readOptionalString(value, 'id');
  const sourceKind = readOptionalString(value, 'source_kind', 'sourceKind');
  const sourceId = readOptionalString(value, 'source_id', 'sourceId');
  const targetKind = readOptionalString(value, 'target_kind', 'targetKind');
  const targetId = readOptionalString(value, 'target_id', 'targetId');
  const transport = readOptionalString(value, 'transport');
  const status = readOptionalString(value, 'status');

  if (!id || !sourceKind || !sourceId || !targetKind || !targetId || !transport || !status) {
    return null;
  }

  return {
    id,
    source_kind: sourceKind,
    source_id: sourceId,
    target_kind: targetKind,
    target_id: targetId,
    transport,
    status,
    latency_ms: readOptionalNumber(value, 'latency_ms', 'latencyMs'),
  };
}

function parseTopologyDeviceLinkList(value: unknown): RuntimeTopologyDeviceLink[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: RuntimeTopologyDeviceLink[] = [];
  for (const item of value) {
    const link = parseTopologyDeviceLink(item);
    if (!link) {
      return null;
    }
    parsed.push(link);
  }
  return parsed;
}

function parseTopologyResponse(value: unknown): RuntimeTopologyResponse | null {
  if (!isObjectRecord(value)) return null;

  const nestedRuntimeHost = value.runtime_host === undefined
    ? null
    : parseTopologyRuntimeHost(value.runtime_host);
  if (value.runtime_host !== undefined && !nestedRuntimeHost) {
    return null;
  }

  const flatCapabilities = value.capabilities === undefined
    ? null
    : parseTopologyCapabilities(value.capabilities);
  if (value.capabilities !== undefined && !flatCapabilities && !nestedRuntimeHost) {
    return null;
  }

  const capabilities = flatCapabilities ?? nestedRuntimeHost?.capabilities ?? null;
  if (!capabilities) {
    return null;
  }

  const hostname = readOptionalString(value, 'hostname') ?? nestedRuntimeHost?.hostname;
  const os = readOptionalString(value, 'os') ?? nestedRuntimeHost?.os;
  const arch = readOptionalString(value, 'arch') ?? nestedRuntimeHost?.arch;
  const uptimeSecs = readOptionalNumber(value, 'uptime_secs', 'uptimeSecs') ?? nestedRuntimeHost?.uptime_secs;
  const version = readOptionalString(value, 'version') ?? nestedRuntimeHost?.version;
  const port = readOptionalNumber(value, 'port') ?? nestedRuntimeHost?.port;

  if (!hostname || !os || !arch || uptimeSecs == null || !version || port == null) {
    return null;
  }

  const hostId = readOptionalString(value, 'host_id', 'hostId') ?? nestedRuntimeHost?.host_id;
  const totalMemoryMb = readOptionalNumber(value, 'total_memory_mb', 'totalMemoryMb') ?? nestedRuntimeHost?.total_memory_mb;
  const usedMemoryMb = readOptionalNumber(value, 'used_memory_mb', 'usedMemoryMb') ?? nestedRuntimeHost?.used_memory_mb;

  const device = value.device === undefined
    ? null
    : parseTopologyDevice(value.device);

  const deviceComponents = value.device_components === undefined
    ? undefined
    : parseTopologyDeviceComponentList(value.device_components);

  const deviceLinks = value.device_links === undefined
    ? undefined
    : parseTopologyDeviceLinkList(value.device_links);

  const runtimeHost = nestedRuntimeHost ?? {
    host_id: hostId,
    hostname,
    os,
    arch,
    uptime_secs: uptimeSecs,
    version,
    port,
    total_memory_mb: totalMemoryMb,
    used_memory_mb: usedMemoryMb,
    capabilities,
  };
  const fallbackDeviceId = runtimeHost.host_id ?? runtimeHost.hostname;

  return {
    host_id: hostId,
    hostname,
    os,
    arch,
    uptime_secs: uptimeSecs,
    version,
    port,
    total_memory_mb: totalMemoryMb,
    used_memory_mb: usedMemoryMb,
    capabilities,
    runtime_host: runtimeHost,
    device: device ?? (
      fallbackDeviceId
        ? {
            id: fallbackDeviceId,
            name: runtimeHost.hostname,
            kind: 'unknown',
            primary_runtime_host_id: runtimeHost.host_id ?? fallbackDeviceId,
          }
        : undefined
    ),
    device_components: deviceComponents ?? [],
    device_links: deviceLinks ?? [],
    device_is_inferred: value.device === undefined,
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
      data: normalizeRuntimeTopologyResponse(parsed),
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
      PTY_STOP_TIMEOUT_MS,
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
    timeoutMs: number = this.timeoutMs,
  ): Promise<RuntimeClientResult<unknown>> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

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
