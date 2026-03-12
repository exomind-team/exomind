import { getSelectedRuntimeTarget, type RuntimeTarget } from '@/config/runtime-target';
import type { IEventLogPort } from '@/lib/environment/interfaces/eventlog.port';
import type { EventData } from '@/lib/types/event';

type RuntimeFetch = typeof fetch;

interface RuntimeEventPayload {
  id: string;
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
    const response = await this.fetchImpl(`${this.baseUrl()}/eventlog`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`RT eventlog list failed: ${response.status}`);
    }
    const payload = await response.json() as RuntimeEventPayload[];
    return payload.map(toEventData);
  }

  async appendEvent(event: EventData): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl()}/eventlog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        id: event.id,
        timestamp: event.timestamp,
        content: event.content,
        tags: event.tags,
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`RT eventlog append failed: ${response.status}`);
    }
  }

  async getEvent(id: string): Promise<EventData | null> {
    const response = await this.fetchImpl(`${this.baseUrl()}/eventlog/events/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
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
    const response = await this.fetchImpl(`${this.baseUrl()}/eventlog`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT eventlog clear failed: ${response.status}`);
    }
  }

  private baseUrl(): string {
    return buildBaseUrl(this.resolveTarget());
  }
}
