import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';

type PublishRequestBody = {
  topic: string;
  source?: string;
  payload: unknown;
  trace_id?: string;
  origin_host_id?: string;
};

type RuntimeSignalEvent = {
  schema_version: 1;
  id: string;
  topic: string;
  ts: number;
  source: string;
  origin_host_id: string;
  hop: number;
  trace_id?: string;
  payload: unknown;
};

type RuntimeTaskPayload = {
  id: string;
  title: string;
  description?: string | null;
  done_condition?: string | null;
  status: 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  tags?: string[];
  source?: string | null;
  parent_id?: string | null;
  depends_on?: Array<{ task_id: string; type: 'soft' | 'hard' }>;
  due_at?: number | null;
  estimated_minutes?: number | null;
  time_block_ids?: string[];
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
};

type RuntimeEventPayload = {
  id: string;
  timestamp: number;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
};

type RuntimeTimeBlockPayload = {
  id: string;
  name: string;
  startId: string;
  endId: string;
  note?: string;
  tags: string[];
  startTime: number;
  endTime: number;
  blockType?: string;
  taskIds?: string[];
  taskAssociationLog?: unknown[];
  transitions?: unknown[];
};

function toTaskReplicationPayload(task: RuntimeTaskPayload, scopeKey: string, originHostId: string) {
  return {
    schemaVersion: 1,
    scopeKey,
    cursor: {
      kind: 'task_snapshot',
      taskId: task.id,
      updatedAt: task.updated_at,
      originHostId,
    },
    task: {
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      doneCondition: task.done_condition ?? undefined,
      status: task.status,
      priority: task.priority,
      tags: task.tags ?? [],
      source: task.source ?? undefined,
      parentId: task.parent_id ?? undefined,
      dependsOn: (task.depends_on ?? []).map((dependency) => ({
        taskId: dependency.task_id,
        type: dependency.type,
      })),
      dueAt: task.due_at ?? undefined,
      estimatedMinutes: task.estimated_minutes ?? undefined,
      timeBlockIds: task.time_block_ids ?? [],
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      completedAt: task.completed_at ?? undefined,
    },
  };
}

const RUNTIME_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID, Cache-Control',
  'Access-Control-Allow-Private-Network': 'true',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  for (const [headerName, headerValue] of Object.entries(RUNTIME_CORS_HEADERS)) {
    res.setHeader(headerName, headerValue);
  }
  res.end(JSON.stringify(body));
}

function writeSseEvent(res: ServerResponse, event: RuntimeSignalEvent): void {
  res.write(`event: signal\n`);
  res.write(`id: ${event.id}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export class FakeMeshRuntime {
  readonly hostId: string;

  private server: Server | null = null;
  private readonly history: RuntimeSignalEvent[] = [];
  private readonly subscribers = new Set<ServerResponse>();
  private readonly eventScopes = new Map<string, Map<string, RuntimeEventPayload>>();
  private readonly taskScopes = new Map<string, Map<string, RuntimeTaskPayload>>();
  private readonly completedTimeBlockScopes = new Map<string, Map<string, RuntimeTimeBlockPayload>>();
  private nextSequence = 1;
  private listenHost = '127.0.0.1';
  private listenPort = 0;
  private peer: FakeMeshRuntime | null = null;

  constructor(hostId: string) {
    this.hostId = hostId;
  }

  setPeer(peer: FakeMeshRuntime): void {
    this.peer = peer;
  }

  async listen(port?: number): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port ?? this.listenPort ?? 0, this.listenHost, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo;
    this.listenPort = address.port;
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    for (const response of this.subscribers) {
      response.end();
    }
    this.subscribers.clear();

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  get address(): string {
    return `${this.listenHost}:${this.listenPort}`;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const scopeKey = this.resolveScopeKey(url);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, RUNTIME_CORS_HEADERS);
      res.end();
      return;
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      json(res, 200, { status: 'ok', host_id: this.hostId });
      return;
    }

    if (url.pathname === '/topology' && req.method === 'GET') {
      json(res, 200, {
        host_id: this.hostId,
        hostname: this.hostId,
        os: 'linux',
        arch: 'x64',
        uptime_secs: 3600,
        version: '0.3.6-e2e',
        port: this.listenPort,
        total_memory_mb: 2048,
        used_memory_mb: 512,
      });
      return;
    }

    if (url.pathname === '/signals/stream' && req.method === 'GET') {
      this.openSignalStream(req, res);
      return;
    }

    if (url.pathname === '/signals/publish' && req.method === 'POST') {
      const body = await this.readJsonBody<PublishRequestBody>(req);
      const event = this.createEvent(body);
      this.acceptEvent(event, true);
      json(res, 200, { accepted: true, event_id: event.id });
      return;
    }

    if (url.pathname === '/eventlog' && req.method === 'GET') {
      json(res, 200, Array.from(this.getEventScope(scopeKey).values()).sort((a, b) => b.timestamp - a.timestamp));
      return;
    }

    if (url.pathname === '/eventlog' && req.method === 'POST') {
      const body = await this.readJsonBody<Partial<RuntimeEventPayload> & { timestamp: number; content: string; tags: string[] }>(req);
      const event: RuntimeEventPayload = {
        id: `${this.hostId}-event-${this.nextSequence++}`,
        timestamp: body.timestamp,
        content: body.content,
        tags: body.tags,
        metadata: body.metadata,
      };
      this.getEventScope(scopeKey).set(event.id, event);
      const replicationEvent = this.createEvent({
        topic: 'eventlog.replication.appended',
        source: 'fake-runtime:eventlog',
        payload: {
          schemaVersion: 1,
          scopeKey,
          replicationSeq: event.timestamp,
          cursor: {
            kind: 'replication_seq',
            value: event.timestamp,
          },
          event: {
            id: event.id,
            content: event.content,
            createdAt: new Date(event.timestamp).toISOString(),
            type: event.tags[0] ?? 'note',
            metadata: event.metadata,
            replicationSeq: event.timestamp,
          },
        },
      });
      this.acceptEvent(replicationEvent, true);
      json(res, 201, event);
      return;
    }

    if (url.pathname === '/eventlog/backup/sqlite' && req.method === 'GET') {
      const payload = Buffer.from(JSON.stringify(Array.from(this.getEventScope(scopeKey).values())), 'utf8').toString('base64');
      json(res, 200, {
        version: 1,
        file_name: 'fake-eventlog.sqlite',
        content_base64: payload,
        event_count: this.getEventScope(scopeKey).size,
      });
      return;
    }

    if (url.pathname === '/eventlog/import/sqlite' && req.method === 'POST') {
      const body = await this.readJsonBody<{ content_base64: string }>(req);
      const importedEvents = JSON.parse(Buffer.from(body.content_base64, 'base64').toString('utf8')) as RuntimeEventPayload[];
      const scope = this.getEventScope(scopeKey);
      let imported = 0;
      let skipped = 0;
      for (const event of importedEvents) {
        if (scope.has(event.id)) {
          skipped += 1;
          continue;
        }
        scope.set(event.id, event);
        imported += 1;
      }
      json(res, 200, {
        imported,
        skipped,
        total: scope.size,
      });
      return;
    }

    if (url.pathname === '/tasks' && req.method === 'GET') {
      json(res, 200, Array.from(this.getTaskScope(scopeKey).values()).sort((a, b) => b.created_at - a.created_at));
      return;
    }

    if (url.pathname === '/tasks/backup/sqlite' && req.method === 'GET') {
      const payload = Buffer.from(JSON.stringify(Array.from(this.getTaskScope(scopeKey).values())), 'utf8').toString('base64');
      json(res, 200, {
        version: 1,
        file_name: 'fake-tasks.sqlite',
        content_base64: payload,
        task_count: this.getTaskScope(scopeKey).size,
      });
      return;
    }

    if (url.pathname === '/tasks' && req.method === 'POST') {
      const body = await this.readJsonBody<Partial<RuntimeTaskPayload> & { title: string }>(req);
      const now = Date.now();
      const task: RuntimeTaskPayload = {
        id: `${this.hostId}-task-${this.nextSequence++}`,
        title: body.title,
        description: body.description ?? null,
        done_condition: body.done_condition ?? null,
        status: 'pending',
        priority: body.priority ?? 'medium',
        tags: body.tags ?? [],
        source: body.source ?? null,
        parent_id: body.parent_id ?? null,
        depends_on: body.depends_on ?? [],
        due_at: body.due_at ?? null,
        estimated_minutes: body.estimated_minutes ?? null,
        time_block_ids: body.time_block_ids ?? [],
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
      this.getTaskScope(scopeKey).set(task.id, task);
      const lifecycleEvent = this.createEvent({
        topic: 'task.created',
        source: 'fake-runtime:tasks',
        payload: task,
      });
      this.acceptEvent(lifecycleEvent, false);
      const replicationEvent = this.createEvent({
        topic: 'task.replication.upserted',
        source: 'fake-runtime:tasks',
        payload: toTaskReplicationPayload(task, scopeKey, this.hostId),
      });
      this.acceptEvent(replicationEvent, true);
      json(res, 201, task);
      return;
    }

    if (url.pathname === '/tasks/replication/upsert' && req.method === 'POST') {
      const body = await this.readJsonBody<{ task: RuntimeTaskPayload }>(req);
      const scope = this.getTaskScope(scopeKey);
      const existing = scope.get(body.task.id);
      if (!existing || body.task.updated_at > existing.updated_at) {
        scope.set(body.task.id, body.task);
        json(res, 200, { status: existing ? 'updated' : 'inserted' });
        return;
      }
      json(res, 200, { status: 'ignored' });
      return;
    }

    if (url.pathname === '/tasks/import/sqlite' && req.method === 'POST') {
      const body = await this.readJsonBody<{ content_base64: string }>(req);
      const importedTasks = JSON.parse(Buffer.from(body.content_base64, 'base64').toString('utf8')) as RuntimeTaskPayload[];
      const scope = this.getTaskScope(scopeKey);
      let imported = 0;
      let skipped = 0;
      for (const task of importedTasks) {
        const existing = scope.get(task.id);
        if (!existing || task.updated_at > existing.updated_at) {
          scope.set(task.id, task);
          imported += existing ? 0 : 1;
        } else {
          skipped += 1;
        }
      }
      json(res, 200, {
        imported,
        skipped,
        total: scope.size,
      });
      return;
    }

    if (url.pathname === '/timeblocks' && req.method === 'GET') {
      json(res, 200, Array.from(this.getCompletedTimeBlockScope(scopeKey).values()).sort((a, b) => b.endTime - a.endTime));
      return;
    }

    if (url.pathname === '/timeblocks/replication/completed' && req.method === 'POST') {
      const body = await this.readJsonBody<{ block: RuntimeTimeBlockPayload }>(req);
      const scope = this.getCompletedTimeBlockScope(scopeKey);
      if (scope.has(body.block.startId)) {
        json(res, 200, { status: 'ignored' });
        return;
      }
      scope.set(body.block.startId, body.block);
      json(res, 200, { status: 'inserted' });
      return;
    }

    json(res, 404, { error: 'not found' });
  }

  private resolveScopeKey(url: URL): string {
    return url.searchParams.get('user_id')
      ?? url.searchParams.get('profile_id')
      ?? 'anonymous';
  }

  private getTaskScope(scopeKey: string): Map<string, RuntimeTaskPayload> {
    if (!this.taskScopes.has(scopeKey)) {
      this.taskScopes.set(scopeKey, new Map());
    }
    return this.taskScopes.get(scopeKey)!;
  }

  private getEventScope(scopeKey: string): Map<string, RuntimeEventPayload> {
    if (!this.eventScopes.has(scopeKey)) {
      this.eventScopes.set(scopeKey, new Map());
    }
    return this.eventScopes.get(scopeKey)!;
  }

  private getCompletedTimeBlockScope(scopeKey: string): Map<string, RuntimeTimeBlockPayload> {
    if (!this.completedTimeBlockScopes.has(scopeKey)) {
      this.completedTimeBlockScopes.set(scopeKey, new Map());
    }
    return this.completedTimeBlockScopes.get(scopeKey)!;
  }

  private openSignalStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      ...RUNTIME_CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const lastEventId = req.headers['last-event-id'];
    const lastSeenId = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
    const replayEvents = this.getReplayEvents(lastSeenId);
    for (const event of replayEvents) {
      writeSseEvent(res, event);
    }

    this.subscribers.add(res);
    req.on('close', () => {
      this.subscribers.delete(res);
    });
  }

  private getReplayEvents(lastEventId?: string): RuntimeSignalEvent[] {
    if (!lastEventId) {
      return [];
    }

    const index = this.history.findIndex((event) => event.id === lastEventId);
    if (index < 0) {
      return this.history;
    }
    return this.history.slice(index + 1);
  }

  private async readJsonBody<T>(req: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(raw) as T;
  }

  private createEvent(body: PublishRequestBody): RuntimeSignalEvent {
    const eventId = `${this.hostId}-evt-${this.nextSequence++}`;
    return {
      schema_version: 1,
      id: eventId,
      topic: body.topic,
      ts: Date.now(),
      source: body.source ?? 'unknown',
      origin_host_id: body.origin_host_id ?? this.hostId,
      hop: 0,
      trace_id: body.trace_id,
      payload: body.payload,
    };
  }

  private acceptEvent(event: RuntimeSignalEvent, forwardToPeer: boolean): void {
    if (this.history.some((item) => item.id === event.id)) {
      return;
    }

    this.history.push(event);
    for (const subscriber of this.subscribers) {
      writeSseEvent(subscriber, event);
    }

    if (forwardToPeer && this.peer) {
      this.peer.acceptEvent(
        {
          ...event,
          hop: event.hop + 1,
        },
        false,
      );
    }
  }
}

export async function startFakeMeshRuntimePair(): Promise<{
  runtimeA: FakeMeshRuntime;
  runtimeB: FakeMeshRuntime;
}> {
  const runtimeA = new FakeMeshRuntime('issue381-host-a');
  const runtimeB = new FakeMeshRuntime('issue381-host-b');

  runtimeA.setPeer(runtimeB);
  runtimeB.setPeer(runtimeA);

  await runtimeA.listen();
  await runtimeB.listen();

  return { runtimeA, runtimeB };
}
