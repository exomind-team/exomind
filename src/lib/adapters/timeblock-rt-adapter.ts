import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type { ActiveBlockData, TimeBlockData } from '@/lib/types/event';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

export interface TimeBlockRtAdapterOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function buildBaseUrl(target: RuntimeTarget): string {
  return `http://${formatHostForUrl(target.host)}:${target.port}`;
}

export class TimeBlockRtAdapter {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: TimeBlockRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async listCompletedBlocks(): Promise<TimeBlockData[]> {
    return this.requestJson<TimeBlockData[]>('/timeblocks');
  }

  async replaceCompletedBlocks(blocks: TimeBlockData[]): Promise<void> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url('/timeblocks', target), {
      method: 'PUT',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(blocks),
    });
    if (!response.ok && response.status !== 204) {
      const body = await response.text().catch(() => '(no body)');
      console.error('[TB-RT] replaceCompletedBlocks failed', { status: response.status, body, blockCount: blocks.length, payload: JSON.stringify(blocks).slice(0, 500) });
      throw new Error(`RT timeblocks replace failed: ${response.status} — ${body}`);
    }
  }

  async getActiveBlock(): Promise<ActiveBlockData | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url('/timeblocks/active', target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT timeblocks active get failed: ${response.status}`);
    }
    return response.json() as Promise<ActiveBlockData>;
  }

  async putActiveBlock(block: ActiveBlockData): Promise<void> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url('/timeblocks/active', target), {
      method: 'PUT',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(block),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT timeblocks active put failed: ${response.status}`);
    }
  }

  /**
   * @deprecated No-op in RT mode. Active block lifecycle is managed via
   * rtStartBlock / rtEndBlock / rtStopBlock. Kept for interface compatibility.
   */
  async deleteActiveBlock(): Promise<void> {
    console.warn('[TB-RT] deleteActiveBlock is a no-op in RT mode');
  }

  // ── #780 新路由方法 ──

  async rtStartBlock(params: { name: string; mode: string; targetMinutes?: number; taskIds?: string[]; sourcePlannedBlockId?: string }): Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }> {
    return this.postJson('/timeblocks/start', params);
  }

  async rtStopBlock(): Promise<{ status: string }> {
    return this.postJson('/timeblocks/stop', {});
  }

  async rtEndBlock(params: { feedback?: string; taskStatusOutcomes?: Record<string, string> }): Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }> {
    return this.postJson('/timeblocks/end', params);
  }

  async rtPauseBlock(): Promise<{ status: string }> {
    return this.postJson('/timeblocks/pause', {});
  }

  async rtResumeBlock(): Promise<{ status: string }> {
    return this.postJson('/timeblocks/resume', {});
  }

  async rtDescribeBlock(params: { name?: string; note?: string }): Promise<{ updated: string; blockId: string }> {
    return this.postJson('/timeblocks/describe', params);
  }

  async rtDescribeBlockById(blockId: string, params: { name?: string; note?: string }): Promise<{ updated: string; blockId: string }> {
    return this.postJson(`/timeblocks/${blockId}/describe`, params);
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      throw new Error(`RT ${path} failed: ${response.status} — ${text}`);
    }
    return response.json() as Promise<T>;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`RT timeblocks request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private baseUrl(target = this.resolveTarget()): string {
    return buildBaseUrl(target);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${this.baseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}
