import type { PublishRequest, PublishResponse } from "./signal-types.js";

const DEFAULT_RT_URL = "http://localhost:1949";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SignalStreamOpenRequest {
  agentId: string;
  heartbeatInterval: number;
  lastEventId?: string | null;
  signal?: AbortSignal;
}

export interface SignalTransport {
  publish(request: PublishRequest): Promise<PublishResponse>;
  openStream(request: SignalStreamOpenRequest): Promise<Response>;
}

export interface HttpSseSignalTransportConfig {
  rtUrl: string;
  source: string;
  timeout: number;
}

export class HttpSseSignalTransport implements SignalTransport {
  private readonly rtUrl: string;
  private readonly source: string;
  private readonly timeout: number;

  constructor(config?: Partial<HttpSseSignalTransportConfig>) {
    this.rtUrl = (config?.rtUrl ?? DEFAULT_RT_URL).replace(/\/$/, "");
    this.source = config?.source ?? "agent";
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    const body: PublishRequest = {
      ...request,
      source: request.source ?? this.source,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.rtUrl}/signals/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`publish failed: HTTP ${response.status}`);
      }

      return (await response.json()) as PublishResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  async openStream(request: SignalStreamOpenRequest): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };
    if (request.lastEventId) {
      headers["Last-Event-ID"] = request.lastEventId;
    }

    const response = await fetch(
      `${this.rtUrl}/signals/stream?agent_id=${encodeURIComponent(request.agentId)}&heartbeat_interval=${request.heartbeatInterval}`,
      {
        headers,
        signal: request.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`SSE HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("SSE response has no body");
    }

    return response;
  }
}
