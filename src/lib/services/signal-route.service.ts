/**
 * SignalRoute Service
 *
 * 路由 CRUD 客户端，对应 Rust RT 的 /signal-routes 端点。
 */

import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type {
  SignalRoute,
  CreateRouteRequest,
  UpdateRouteRequest,
} from '@/lib/types/signal-pool';
import { formatHostForUrl } from '@/config/runtime-target';

// ── 工具函数 ──────────────────────────────────────────────────

function buildBaseUrl(host: RuntimeHostRecord): string {
  return `http://${formatHostForUrl(host.host)}:${host.port}`;
}

// ── Service ──────────────────────────────────────────────────

export interface SignalRouteServiceOptions {
  host: RuntimeHostRecord;
}

export class SignalRouteService {
  private readonly baseUrl: string;

  constructor(options: SignalRouteServiceOptions) {
    this.baseUrl = buildBaseUrl(options.host);
  }

  async listRoutes(): Promise<SignalRoute[]> {
    const response = await fetch(`${this.baseUrl}/signal-routes`);
    if (!response.ok) {
      throw new Error(`listRoutes failed: HTTP ${response.status}`);
    }
    return (await response.json()) as SignalRoute[];
  }

  async createRoute(request: CreateRouteRequest): Promise<SignalRoute> {
    const response = await fetch(`${this.baseUrl}/signal-routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`createRoute failed: HTTP ${response.status}`);
    }
    return (await response.json()) as SignalRoute;
  }

  async updateRoute(id: string, updates: UpdateRouteRequest): Promise<SignalRoute> {
    const response = await fetch(`${this.baseUrl}/signal-routes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error(`updateRoute failed: HTTP ${response.status}`);
    }
    return (await response.json()) as SignalRoute;
  }

  async deleteRoute(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/signal-routes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`deleteRoute failed: HTTP ${response.status}`);
    }
  }
}

// ── Singleton ────────────────────────────────────────────────

let signalRouteInstance: SignalRouteService | null = null;

export function getSignalRouteService(options: SignalRouteServiceOptions): SignalRouteService {
  if (!signalRouteInstance) {
    signalRouteInstance = new SignalRouteService(options);
  }
  return signalRouteInstance;
}

export function resetSignalRouteServiceForTests(): void {
  signalRouteInstance = null;
}
