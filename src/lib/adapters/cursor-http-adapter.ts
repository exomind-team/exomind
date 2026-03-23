/**
 * CursorHttpAdapter
 *
 * ICursorPort 的 HTTP 实现，调用 agent-cursor.exe 的 localhost:19490 API
 */

import type {
  ICursorPort,
  CursorStatus,
  CursorMoveParams,
  CursorClickParams,
  CursorTypeParams,
  CursorScrollParams,
  CursorEvent,
} from '@/environment/interfaces/cursor.port';
import { log } from '@/lib/logger';

interface CursorHttpAdapterConfig {
  baseUrl?: string;
  apiKey?: string;
}

export class CursorHttpAdapter implements ICursorPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: CursorHttpAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:19490';
    this.apiKey =
      config.apiKey ??
      (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__CURSOR_API_KEY__ as string : undefined) ??
      (typeof process !== 'undefined' ? process.env?.MULTI_CURSOR_API_KEY : undefined) ??
      '';
  }

  private headers(hasBody = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<CursorStatus> {
    const res = await fetch(`${this.baseUrl}/status`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getStatus failed: ${res.status}`);
    const data = await res.json() as {
      mode: string;
      screen: { x: number; y: number; w: number; h: number };
      devices: Array<{ isAgent: boolean; x: number; y: number }>;
    };
    const agent = data.devices?.find((d) => d.isAgent);
    return {
      mode: data.mode as 'visual' | 'full_control',
      screen: data.screen,
      agentPos: agent ? { x: agent.x, y: agent.y } : undefined,
    };
  }

  async screenshot(): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/agent/screenshot`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`screenshot failed: ${res.status}`);
    return res.blob();
  }

  async move(params: CursorMoveParams): Promise<{ x: number; y: number }> {
    const { agentId = 0, ...body } = params;
    const res = await fetch(`${this.baseUrl}/agent/move?id=${agentId}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ x: number; y: number }>;
  }

  async click(params: CursorClickParams): Promise<void> {
    const { agentId = 0, ...body } = params;
    await fetch(`${this.baseUrl}/agent/click?id=${agentId}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
  }

  async type(params: CursorTypeParams): Promise<void> {
    const { agentId = 0, ...body } = params;
    await fetch(`${this.baseUrl}/agent/type?id=${agentId}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
  }

  async scroll(params: CursorScrollParams): Promise<void> {
    const { agentId = 0, ...body } = params;
    await fetch(`${this.baseUrl}/agent/scroll?id=${agentId}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
  }

  async setMode(_mode: 'full_control' | 'visual'): Promise<void> {
    await fetch(`${this.baseUrl}/agent/toggle`, {
      method: 'POST',
      headers: this.headers(true),
      body: '{}',
    });
  }

  subscribe(onEvent: (event: CursorEvent) => void): () => void {
    const controller = new AbortController();
    let closed = false;

    void (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/events`, {
          headers: this.headers(),
          signal: controller.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as CursorEvent;
                if (!event.timestamp) event.timestamp = new Date().toISOString();
                onEvent(event);
              } catch {
                // ignore malformed lines
              }
            }
          }
        }
      } catch (e) {
        if (!closed) log.warn(`[CursorHttpAdapter] SSE disconnected: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      closed = true;
      controller.abort();
    };
  }
}
