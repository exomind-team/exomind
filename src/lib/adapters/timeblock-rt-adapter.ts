import { getSelectedRuntimeTarget, type RuntimeTarget } from '@/config/runtime-target';
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
    const response = await this.fetchImpl(this.url('/timeblocks'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(blocks),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT timeblocks replace failed: ${response.status}`);
    }
  }

  async getActiveBlock(): Promise<ActiveBlockData | null> {
    const response = await this.fetchImpl(this.url('/timeblocks/active'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
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
    const response = await this.fetchImpl(this.url('/timeblocks/active'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(block),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT timeblocks active put failed: ${response.status}`);
    }
  }

  async deleteActiveBlock(): Promise<void> {
    const response = await this.fetchImpl(this.url('/timeblocks/active'), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT timeblocks active delete failed: ${response.status}`);
    }
  }

  private async requestJson<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`RT timeblocks request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private baseUrl(): string {
    return buildBaseUrl(this.resolveTarget());
  }

  private url(path: string): string {
    return `${this.baseUrl()}${appendRuntimeProfileScope(path)}`;
  }
}
