import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type {
  CreateSchedulingWindowInput,
  ReflowSchedulingWindowInput,
  TimeBlockData,
  TodayPlannerSnapshot,
  TodayPlannerSegment,
  TodayPlannerWindow,
  UpdatePlannedSegmentInput,
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

  async createSchedulingWindow(input: CreateSchedulingWindowInput): Promise<TodayPlannerWindow> {
    return this.requestJsonWithBody<TodayPlannerWindow>('/act/today-planner/windows', 'POST', input);
  }

  async updatePlannedSegment(segmentId: string, input: UpdatePlannedSegmentInput): Promise<TodayPlannerSegment> {
    const payload = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.linkedTaskIds !== undefined ? { linkedTaskIds: input.linkedTaskIds } : {}),
    };
    return this.requestJsonWithBody<TodayPlannerSegment>(
      `/act/today-planner/segments/${encodeURIComponent(segmentId)}`,
      'PATCH',
      payload,
    );
  }

  async startWorkSegment(segmentId: string): Promise<TimeBlockData> {
    return this.requestJsonWithBody<TimeBlockData>(
      `/act/today-planner/segments/${encodeURIComponent(segmentId)}/start`,
      'POST',
    );
  }

  async reflowSchedulingWindow(windowId: string, input: ReflowSchedulingWindowInput): Promise<TodayPlannerWindow> {
    return this.requestJsonWithBody<TodayPlannerWindow>(
      `/act/today-planner/windows/${encodeURIComponent(windowId)}/reflow`,
      'POST',
      input,
    );
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
