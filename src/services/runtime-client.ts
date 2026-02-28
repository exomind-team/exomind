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

type RuntimeFetch = typeof fetch;

export interface RuntimeClientOptions {
  fetchImpl?: RuntimeFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3500;

function buildBaseUrl(host: RuntimeHostRecord): string {
  return `http://${host.host}:${host.port}`;
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
  if (typeof value.hostname !== 'string') return null;
  if (typeof value.os !== 'string') return null;
  if (typeof value.arch !== 'string') return null;
  if (typeof value.uptime_secs !== 'number') return null;
  if (typeof value.version !== 'string') return null;
  if (typeof value.port !== 'number') return null;

  return {
    hostname: value.hostname,
    os: value.os,
    arch: value.arch,
    uptime_secs: value.uptime_secs,
    version: value.version,
    port: value.port,
  };
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

  private async getJson(url: string): Promise<RuntimeClientResult<unknown>> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
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
