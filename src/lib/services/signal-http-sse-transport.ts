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

export function buildSignalStreamUrl(baseUrl: string, agentId: string, heartbeatInterval: number, authToken?: string): string {
  let url = `${baseUrl}/signals/stream?agent_id=${encodeURIComponent(agentId)}&heartbeat_interval=${heartbeatInterval}`;
  if (authToken) {
    url += `&token=${encodeURIComponent(authToken)}`;
  }
  return url;
}

export class HttpSseSignalTransport implements SignalTransport {
  private readonly baseUrl: string;
  private readonly host: RuntimeHostRecord;

  constructor(options: HttpSseSignalTransportOptions) {
    this.host = options.host;
    this.baseUrl = buildSignalBaseUrl(options.host);
  }

  /** Build common headers with optional Bearer auth token. */
  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.host.authToken) {
      headers['Authorization'] = `Bearer ${this.host.authToken}`;
    }
    return headers;
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
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`publish failed: HTTP ${response.status}`);
    }

    return (await response.json()) as PublishResponse;
  }

  async history(limit?: number): Promise<SignalEvent[]> {
    const params = limit != null ? `?limit=${limit}` : '';
    const response = await fetch(`${this.baseUrl}/signals/history${params}`, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`history failed: HTTP ${response.status}`);
    }

    return (await response.json()) as SignalEvent[];
  }

  async openStream(request: SignalStreamOpenRequest): Promise<Response> {
    const headers = this.authHeaders({
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    if (request.lastEventId) {
      headers['Last-Event-ID'] = request.lastEventId;
    }

    // SSE via fetch: pass auth token as query param as well (EventSource fallback doesn't support headers)
    const url = buildSignalStreamUrl(this.baseUrl, request.agentId, request.heartbeatInterval, this.host.authToken);

    const response = await fetch(url, {
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
