import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type { IReminderPort } from '@/lib/environment/interfaces/reminder.port';
import type {
  CreateReminderInput,
  Reminder,
  ReminderStatus,
  UpdateReminderInput,
} from '@/lib/types/reminder';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

interface RuntimeReminderPayload {
  id: string;
  title: string;
  content: string;
  due_at: number;
  status: ReminderStatus;
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
}

export interface ReminderRtAdapterOptions {
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

function toReminder(payload: RuntimeReminderPayload): Reminder {
  return {
    id: payload.id,
    title: payload.title,
    content: payload.content,
    dueAt: payload.due_at,
    status: payload.status,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    completedAt: payload.completed_at ?? undefined,
  };
}

export class ReminderRtAdapter implements IReminderPort {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: ReminderRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async listReminders(): Promise<Reminder[]> {
    const payload = await this.requestJson<RuntimeReminderPayload[]>('/reminders');
    return payload.map(toReminder);
  }

  async getReminderById(id: string): Promise<Reminder | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/reminders/${encodeURIComponent(id)}`, target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT reminder get failed: ${response.status}`);
    }
    return toReminder(await response.json() as RuntimeReminderPayload);
  }

  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const payload = await this.requestJson<RuntimeReminderPayload>('/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        title: input.title,
        content: input.content,
        due_at: input.dueAt,
      }),
    });
    return toReminder(payload);
  }

  async updateReminder(id: string, input: UpdateReminderInput): Promise<Reminder | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/reminders/${encodeURIComponent(id)}`, target), {
      method: 'PUT',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        ...('title' in input ? { title: input.title } : {}),
        ...('content' in input ? { content: input.content } : {}),
        ...('dueAt' in input ? { due_at: input.dueAt } : {}),
      }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT reminder update failed: ${response.status}`);
    }
    return toReminder(await response.json() as RuntimeReminderPayload);
  }

  async transitionReminder(id: string, to: ReminderStatus, at?: number): Promise<Reminder | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/reminders/${encodeURIComponent(id)}/transition`, target), {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        status: to,
        ...(typeof at === 'number' ? { at } : {}),
      }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT reminder transition failed: ${response.status}`);
    }
    return toReminder(await response.json() as RuntimeReminderPayload);
  }

  async applyReplicationSnapshot(
    reminder: Reminder,
    sourceHostId?: string,
  ): Promise<'inserted' | 'updated' | 'ignored'> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url('/reminders/replication/upsert', target), {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        reminder: {
          id: reminder.id,
          title: reminder.title,
          content: reminder.content,
          due_at: reminder.dueAt,
          status: reminder.status,
          created_at: reminder.createdAt,
          updated_at: reminder.updatedAt,
          completed_at: reminder.completedAt ?? null,
        },
        source_host_id: sourceHostId,
      }),
    });
    if (!response.ok) {
      throw new Error(`RT reminder replication upsert failed: ${response.status}`);
    }
    const payload = await response.json() as { status?: 'inserted' | 'updated' | 'ignored' };
    return payload.status ?? 'ignored';
  }

  async startSync(_remoteUrl: string): Promise<void> {
    // RT-only reminder path no longer uses remote DB sync（RT-only 提醒链路不再依赖远端 DB 同步）.
  }

  async stopSync(): Promise<void> {
    // no-op
  }

  onRemoteChange(_callback: (change: unknown) => void): () => void {
    return () => {};
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      ...init,
      headers: buildRuntimeAuthHeaders(target, {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`RT reminder request failed: ${response.status}`);
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
