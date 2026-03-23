import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type { IEventLogPort } from '@/lib/environment/interfaces/eventlog.port';
import type { EventData } from '@/lib/types/event';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

interface RuntimeEventPayload {
  id: string;
  timestamp: number;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

interface RuntimeAppendEventPayload {
  timestamp: number;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface EventLogRtAdapterOptions {
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

function toEventData(payload: RuntimeEventPayload): EventData {
  return {
    id: payload.id,
    timestamp: payload.timestamp,
    content: payload.content,
    tags: payload.tags ?? [],
    metadata: payload.metadata,
  };
}

export class EventLogRtAdapter implements IEventLogPort {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: EventLogRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async listEvents(): Promise<EventData[]> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url('/eventlog', target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`RT eventlog list failed: ${response.status}`);
    }
    const payload = await response.json() as RuntimeEventPayload[];
    return payload.map(toEventData);
  }

  async appendEvent(event: EventData): Promise<EventData> {
    const target = this.resolveTarget();
    const payload: RuntimeAppendEventPayload = {
      timestamp: event.timestamp,
      content: event.content,
      tags: event.tags,
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    };
    const response = await this.fetchImpl(this.url('/eventlog', target), {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`RT eventlog append failed: ${response.status}`);
    }
    return toEventData(await response.json() as RuntimeEventPayload);
  }

  async getEvent(id: string): Promise<EventData | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/eventlog/events/${encodeURIComponent(id)}`, target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT eventlog get failed: ${response.status}`);
    }
    return toEventData(await response.json() as RuntimeEventPayload);
  }

  async clearEvents(): Promise<void> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url('/eventlog', target), {
      method: 'DELETE',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT eventlog clear failed: ${response.status}`);
    }
  }

  private baseUrl(target = this.resolveTarget()): string {
    return buildBaseUrl(target);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${this.baseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}
