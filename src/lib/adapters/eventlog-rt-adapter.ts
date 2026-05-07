import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from "@/config/runtime-target";
import type {
  EventLogAppendInput,
  EventLogImportResult,
  EventLogListOptions,
  EventLogListResult,
  EventLogListSemantics,
  IEventLogPort,
} from "@/lib/environment/interfaces/eventlog.port";
import { normalizeEventRefs } from "@/lib/eventlog/event-refs";
import type { EventData, EventRef } from "@/lib/types/event";
import { appendRuntimeProfileScope } from "./runtime-profile-scope";

type RuntimeFetch = typeof fetch;
const EVENTLOG_REVISION_HEADER = "x-exomind-eventlog-revision";
const EVENTLOG_LIST_SEMANTICS_HEADER = "x-exomind-eventlog-list-semantics";

interface RuntimeEventPayload {
  id: string;
  timestamp: number;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  refs?: EventRef[];
}

interface RuntimeAppendEventPayload {
  id: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  refs?: EventRef[];
}

export interface EventLogRtAdapterOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
}

function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
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
    refs: normalizeEventRefs(payload.refs),
  };
}

export class EventLogRtAdapter implements IEventLogPort {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: EventLogRtAdapterOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget =
      options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async listEvents(options?: EventLogListOptions): Promise<EventData[]> {
    const result = await this.listEventsDetailed(options);
    return result.events;
  }

  async listEventsDetailed(
    options?: EventLogListOptions,
  ): Promise<EventLogListResult> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(
      this.url(this.buildListPath(options), target),
      {
        method: "GET",
        headers: buildRuntimeAuthHeaders(target, {
          Accept: "application/json",
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`RT eventlog list failed: ${response.status}`);
    }
    const payload = (await response.json()) as RuntimeEventPayload[];
    return {
      events: payload.map(toEventData),
      semantics: this.resolveListSemantics(options, response.headers),
      snapshotRevision:
        response.headers?.get(EVENTLOG_REVISION_HEADER) ?? undefined,
    };
  }

  async appendEvent(event: EventLogAppendInput): Promise<EventData> {
    const target = this.resolveTarget();
    const payload: RuntimeAppendEventPayload = {
      id: event.id,
      content: event.content,
      tags: event.tags,
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      ...(normalizeEventRefs(event.refs).length > 0
        ? { refs: normalizeEventRefs(event.refs) }
        : {}),
    };
    const response = await this.fetchImpl(this.url("/eventlog", target), {
      method: "POST",
      headers: buildRuntimeAuthHeaders(target, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`RT eventlog append failed: ${response.status}`);
    }
    return toEventData((await response.json()) as RuntimeEventPayload);
  }

  async appendRawEvent(event: EventData): Promise<EventData> {
    const result = await this.importEventsFromJson(
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        events: [event],
      }),
      "merge",
    );
    if (result.total < 1) {
      throw new Error("RT eventlog raw append failed: import did not persist event");
    }
    const persisted = await this.getEvent(event.id);
    if (!persisted) {
      throw new Error(`RT eventlog raw append failed: missing persisted event ${event.id}`);
    }
    return persisted;
  }

  async importEventsFromJson(
    json: string,
    strategy: "merge" | "overwrite",
  ): Promise<EventLogImportResult> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(
      this.url(`/eventlog/import/json?strategy=${strategy}`, target),
      {
        method: "POST",
        headers: buildRuntimeAuthHeaders(target, {
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
        body: json,
      },
    );
    if (!response.ok) {
      throw new Error(`RT eventlog import failed: ${response.status}`);
    }
    return (await response.json()) as EventLogImportResult;
  }

  async getEvent(id: string): Promise<EventData | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(
      this.url(`/eventlog/${encodeURIComponent(id)}`, target),
      {
        method: "GET",
        headers: buildRuntimeAuthHeaders(target, {
          Accept: "application/json",
        }),
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT eventlog get failed: ${response.status}`);
    }
    return toEventData((await response.json()) as RuntimeEventPayload);
  }

  async clearEvents(): Promise<void> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url("/eventlog", target), {
      method: "DELETE",
      headers: buildRuntimeAuthHeaders(target, { Accept: "application/json" }),
    });
    if (!response.ok && response.status !== 204) {
      throw new Error(`RT eventlog clear failed: ${response.status}`);
    }
  }

  private baseUrl(target = this.resolveTarget()): string {
    return buildBaseUrl(target);
  }

  private buildListPath(options?: EventLogListOptions): string {
    const url = new URL("/eventlog", "http://runtime.local");

    if (typeof options?.sinceId === "string" && options.sinceId.length > 0) {
      url.searchParams.set("since_id", options.sinceId);
    }
    if (typeof options?.sinceTimestamp === "number") {
      url.searchParams.set("since_timestamp", String(options.sinceTimestamp));
    }
    if (typeof options?.untilTimestamp === "number") {
      url.searchParams.set("until_timestamp", String(options.untilTimestamp));
    }
    if (typeof options?.limit === "number") {
      url.searchParams.set("limit", String(options.limit));
    }

    return `${url.pathname}${url.search}`;
  }

  private resolveListSemantics(
    options?: EventLogListOptions,
    headers?: Headers,
  ): EventLogListSemantics {
    const headerValue = headers?.get(EVENTLOG_LIST_SEMANTICS_HEADER);
    if (
      headerValue === "full_snapshot" ||
      headerValue === "incremental_batch"
    ) {
      return headerValue;
    }

    const hasIncrementalCursor =
      (typeof options?.sinceId === "string" && options.sinceId.length > 0) ||
      typeof options?.sinceTimestamp === "number";
    return hasIncrementalCursor ? "incremental_batch" : "full_snapshot";
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${this.baseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}
