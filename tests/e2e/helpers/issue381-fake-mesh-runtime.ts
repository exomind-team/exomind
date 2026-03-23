import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

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

    json(res, 404, { error: 'not found' });
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
