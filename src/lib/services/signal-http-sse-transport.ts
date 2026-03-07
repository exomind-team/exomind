import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { PublishRequest, PublishResponse, SignalEvent } from '@/lib/types/signal-pool';
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface SignalStreamOpenRequest {
  agentId: string;
  heartbeatInterval: number;
  lastEventId?: string | null;
  signal?: AbortSignal;
}

export interface SignalTransport {
  publish(request: PublishRequest): Promise<PublishResponse>;
  history(limit?: number): Promise<SignalEvent[]>;
  openStream(request: SignalStreamOpenRequest): Promise<Response>;
}

export interface HttpSseSignalTransportOptions {
  host: RuntimeHostRecord;
}

export function buildSignalBaseUrl(host: RuntimeHostRecord): string {
  return `http://${host.host}:${host.port}`;
}

export function buildSignalStreamUrl(baseUrl: string, agentId: string, heartbeatInterval: number): string {
  return `${baseUrl}/signals/stream?agent_id=${encodeURIComponent(agentId)}&heartbeat_interval=${heartbeatInterval}`;
}

export class HttpSseSignalTransport implements SignalTransport {
  private readonly baseUrl: string;
  private readonly host: RuntimeHostRecord;

  constructor(options: HttpSseSignalTransportOptions) {
    this.host = options.host;
    this.baseUrl = buildSignalBaseUrl(options.host);
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    if (this.host.isLocal && await isTauri()) {
      try {
        return await invoke<PublishResponse>('signal_publish_fast', { request });
      } catch (error) {
        console.warn('[SignalTransport] invoke publish failed, fallback to HTTP:', error);
      }
    }

    const response = await fetch(`${this.baseUrl}/signals/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`publish failed: HTTP ${response.status}`);
    }

    return (await response.json()) as PublishResponse;
  }

  async history(limit?: number): Promise<SignalEvent[]> {
    const params = limit != null ? `?limit=${limit}` : '';
    const response = await fetch(`${this.baseUrl}/signals/history${params}`);

    if (!response.ok) {
      throw new Error(`history failed: HTTP ${response.status}`);
    }

    return (await response.json()) as SignalEvent[];
  }

  async openStream(request: SignalStreamOpenRequest): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (request.lastEventId) {
      headers['Last-Event-ID'] = request.lastEventId;
    }

    const response = await fetch(buildSignalStreamUrl(this.baseUrl, request.agentId, request.heartbeatInterval), {
      headers,
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    return response;
  }
}
