import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type {
  PublishRequest,
  PublishResponse,
  SignalEvent,
  SignalHistoryQuery,
} from '@/lib/types/signal-pool';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import {
  buildRuntimeAuthHeaders,
  resolveRuntimeHostBaseUrl,
} from '@/lib/utils/runtime-host-address';

export interface SignalStreamOpenRequest {
  agentId: string;
  heartbeatInterval: number;
  lastEventId?: string | null;
  signal?: AbortSignal;
}

export interface SignalTransport {
  publish(request: PublishRequest): Promise<PublishResponse>;
  history(query?: number | SignalHistoryQuery): Promise<SignalEvent[]>;
  openStream(request: SignalStreamOpenRequest): Promise<Response>;
}

export interface HttpSseSignalTransportOptions {
  host: RuntimeHostRecord;
}

export function buildSignalBaseUrl(host: RuntimeHostRecord): string {
  return resolveRuntimeHostBaseUrl(host);
}

export function buildSignalStreamUrl(baseUrl: string, agentId: string, heartbeatInterval: number, authToken?: string): string {
  let url = `${baseUrl}/signals/stream?agent_id=${encodeURIComponent(agentId)}&heartbeat_interval=${heartbeatInterval}`;
  if (authToken) {
    url += `&token=${encodeURIComponent(authToken)}`;
  }
  return url;
}

function redactSignalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('token')) {
      parsed.searchParams.set('token', '***');
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&]token=)[^&]+/i, '$1***');
  }
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
    return Object.fromEntries(buildRuntimeAuthHeaders(this.host.authToken, extra).entries());
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    if (this.host.isLocal && await isTauri()) {
      try {
        return await invoke<PublishResponse>('signal_publish_fast', { request });
      } catch (error) {
        log.warn(`[SignalTransport] invoke publish failed, fallback to HTTP: ${error instanceof Error ? error.message : String(error)}`);
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

  async history(query?: number | SignalHistoryQuery): Promise<SignalEvent[]> {
    const normalizedQuery = typeof query === 'number'
      ? { limit: query }
      : (query ?? {});
    const search = new URLSearchParams();
    if (normalizedQuery.limit != null) {
      search.set('limit', String(normalizedQuery.limit));
    }
    if (normalizedQuery.topicPrefix) {
      search.set('topic_prefix', normalizedQuery.topicPrefix);
    }
    if (normalizedQuery.afterEventId) {
      search.set('after_event_id', normalizedQuery.afterEventId);
    }
    if (normalizedQuery.excludeTopicPrefix) {
      search.set('exclude_topic_prefix', normalizedQuery.excludeTopicPrefix);
    }
    const params = search.size > 0 ? `?${search.toString()}` : '';
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
    const safeUrl = redactSignalUrl(url);

    log.info(
      `[SignalTransport] openStream:start url=${safeUrl} lastEventId=${request.lastEventId ? 'present' : 'none'} auth=${this.host.authToken ? 'present' : 'none'}`
    );

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: request.signal,
      });
    } catch (error) {
      log.warn(`[SignalTransport] openStream:fetch-error url=${safeUrl} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    log.info(
      `[SignalTransport] openStream:response url=${safeUrl} status=${response.status} contentType=${response.headers.get('content-type') ?? 'unknown'} body=${response.body ? 'present' : 'missing'}`
    );

    if (!response.ok) {
      throw new Error(`SSE HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    return response;
  }
}
