import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type {
  ActiveBlockData,
  CreatePlannedTimeBlockInput,
  TodayPlannerBlock,
  TodayPlannerSnapshot,
  UpdatePlannedTimeBlockInput,
} from '@/lib/types/event';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

export interface TodayPlannerRtAdapterOptions {
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

export class TodayPlannerRtAdapter {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: TodayPlannerRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async getTodayPlanner(date: string): Promise<TodayPlannerSnapshot> {
    return this.requestJson<TodayPlannerSnapshot>(`/act/today-planner?date=${encodeURIComponent(date)}`);
  }

  async createPlannedBlock(input: CreatePlannedTimeBlockInput): Promise<TodayPlannerBlock> {
    return this.requestJsonWithBody<TodayPlannerBlock>('/act/today-planner/blocks', 'POST', {
      ...input,
      linkedTaskIds: input.linkedTaskIds ?? [],
    });
  }

  async updatePlannedBlock(blockId: string, input: UpdatePlannedTimeBlockInput): Promise<TodayPlannerBlock> {
    return this.requestJsonWithBody<TodayPlannerBlock>(`/act/today-planner/blocks/${encodeURIComponent(blockId)}`, 'PATCH', input);
  }

  async reorderPlannedBlocks(date: string, orderedIds: string[]): Promise<TodayPlannerSnapshot> {
    return this.requestJsonWithBody<TodayPlannerSnapshot>('/act/today-planner/blocks/reorder', 'POST', {
      date,
      orderedIds,
    });
  }

  async startPlannedBlock(blockId: string): Promise<ActiveBlockData> {
    return this.requestJsonWithBody<ActiveBlockData>(`/act/today-planner/blocks/${encodeURIComponent(blockId)}/start`, 'POST');
  }

  async deletePlannedBlock(blockId: string): Promise<void> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/act/today-planner/blocks/${encodeURIComponent(blockId)}`, target), {
      method: 'DELETE',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT today planner delete failed: ${response.status}`);
    }
  }

  private async requestJson<T>(path: string): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`RT today planner request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private async requestJsonWithBody<T>(path: string, method: 'POST' | 'PATCH', body?: unknown): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      method,
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      throw new Error(`RT today planner ${method} failed: ${response.status}`);
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
