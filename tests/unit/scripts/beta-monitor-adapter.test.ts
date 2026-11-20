// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const adapterPath = join(repository, 'skills/exomind-rt-agent-access/scripts/beta-monitor-adapter.mjs');
const adapterUrl = pathToFileURL(adapterPath);
const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE_ID = '11111111-1111-4111-8111-111111111112';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const RUNTIME_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
const HUMAN_ID = '66666666-6666-4666-8666-666666666666';
const COMMAND_ID = '77777777-7777-4777-8777-777777777777';
const EVENT_ID = '88888888-8888-4888-8888-888888888888';
const VIDEO_ID = '99999999-9999-4999-8999-999999999999';
const TOKEN = 'a'.repeat(64);
const READ_CAPABILITIES = ['events_read', 'timeblocks_read', 'originals_read', 'wait'];

type Call = {
  method: string;
  url: URL;
  headers: IncomingMessage['headers'];
  body: unknown;
};

type Host = {
  apiBaseUrl: string;
  calls: Call[];
  close: () => Promise<void>;
};

const hosts: Host[] = [];
const temporaryDirectories: string[] = [];

async function loadFactory() {
  const module = await import(adapterUrl.href);
  if (typeof module.createBetaMonitorAdapter !== 'function') {
    throw new Error('createBetaMonitorAdapter export is required');
  }
  return module.createBetaMonitorAdapter;
}

function memoryStateStore() {
  const values = new Map<string, any>();
  return {
    values,
    async load(key: string) {
      const value = values.get(key);
      return value === undefined ? null : JSON.parse(JSON.stringify(value));
    },
    async save(key: string, value: unknown) {
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

function nativeHandoff(
  apiBaseUrl: string,
  options: {
    kind?: 'observer' | 'agent_note' | 'human';
    profileId?: string;
    agentId?: string | null;
  } = {},
) {
  const kind = options.kind ?? 'observer';
  return {
    protocol: 'exomind-beta/1',
    api_base_url: apiBaseUrl,
    api: {
      hello: 'GET /hello',
      access_check: 'POST /profiles/{profile_id}/access/check',
      authorization_header: 'Authorization: Bearer <credential.token>',
    },
    device: { device_id: DEVICE_ID },
    profile: {
      profile_id: options.profileId ?? PROFILE_ID,
      display_name: 'Synthetic monitor fixture',
    },
    grant: {
      grant_id: GRANT_ID,
      kind,
      agent_id: options.agentId ?? (kind === 'agent_note' ? AGENT_ID : null),
    },
    credential: { scheme: 'Bearer', token: TOKEN },
    network: { listener_scope: 'loopback_only', remote_clients_reachable: false },
  };
}

function target(apiBaseUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    apiBaseUrl,
    runtimeId: RUNTIME_ID,
    profileId: PROFILE_ID,
    ...overrides,
  };
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function uuid(prefix: string, sequence: number) {
  return prefix + '-0000-4000-8000-' + String(sequence).padStart(12, '0');
}

function json(response: ServerResponse, value: unknown, status = 200) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  const contentType = String(request.headers['content-type'] ?? '');
  if (contentType.includes('application/json') && bytes.length > 0) {
    return JSON.parse(bytes.toString('utf8'));
  }
  return bytes;
}
async function startHost(
  handler: (call: Call, response: ServerResponse) => void | Promise<void>,
): Promise<Host> {
  const calls: Call[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const call: Call = {
        method: request.method ?? 'GET',
        url,
        headers: request.headers,
        body: await readRequestBody(request),
      };
      calls.push(call);
      await handler(call, response);
    })().catch(() => {
      if (!response.destroyed && !response.headersSent) {
        json(response, { error: { code: 'fixture_failure' } }, 500);
      } else if (!response.destroyed) {
        response.destroy();
      }
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address() as AddressInfo;
  const host: Host = {
    apiBaseUrl: 'http://127.0.0.1:' + address.port + '/beta/v1',
    calls,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
  hosts.push(host);
  return host;
}

function replyIdentity(
  call: Call,
  response: ServerResponse,
  options: {
    protocol?: string;
    runtimeId?: string;
    deviceId?: string;
    profileId?: string;
    grantKind?: 'observer' | 'agent_note' | 'human';
    agentId?: string | null;
    allowed?: string[];
  } = {},
) {
  const protocol = options.protocol ?? 'exomind-beta/1';
  const runtimeId = options.runtimeId ?? RUNTIME_ID;
  const deviceId = options.deviceId ?? DEVICE_ID;
  const profileId = options.profileId ?? PROFILE_ID;
  const grantKind = options.grantKind ?? 'observer';
  const agentId = options.agentId ?? (grantKind === 'agent_note' ? AGENT_ID : null);

  if (call.method === 'GET' && call.url.pathname === '/beta/v1/hello') {
    json(response, { protocol, runtime_id: runtimeId, device_id: deviceId, running: true });
    return true;
  }
  if (call.method === 'POST'
    && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/access/check') {
    json(response, {
      protocol,
      runtime_id: runtimeId,
      device_id: deviceId,
      profile_id: profileId,
      grant_kind: grantKind,
      agent_id: agentId,
      allowed: options.allowed ?? [
        ...READ_CAPABILITIES,
        'timeline_read',
        ...(grantKind === 'agent_note' ? ['capture_append_agent_note'] : []),
      ],
      max_original_chunk_bytes: 262144,
    });
    return true;
  }
  return false;
}

function sequenceOf(item: any) {
  const record = item?.record ?? item?.fact ?? item;
  return record?.local_seq ?? item?.local_seq;
}

function page(call: Call, response: ServerResponse, items: any[], highwater: number) {
  const through = call.url.searchParams.get('through');
  if (through !== null && Number(through) !== highwater) {
    json(response, { error: { code: 'snapshot_mismatch' } }, 409);
    return;
  }
  const beforeValue = call.url.searchParams.get('before');
  const before = beforeValue === null ? Number.MAX_SAFE_INTEGER : Number(beforeValue);
  const requestedLimit = Number(call.url.searchParams.get('limit') ?? '100');
  const limit = Math.min(100, Math.max(1, requestedLimit));
  const remaining = items.filter((item) => sequenceOf(item) < before);
  const itemsInPage = remaining.slice(0, limit);
  const nextBefore = remaining.length > itemsInPage.length
    ? sequenceOf(itemsInPage[itemsInPage.length - 1])
    : null;
  json(response, { items: itemsInPage, next_before: nextBefore, highwater });
}

function capture(sequence: number, options: Record<string, any> = {}) {
  const eventId = uuid('10000000', sequence);
  return {
    event_id: eventId,
    profile_id: PROFILE_ID,
    device_id: DEVICE_ID,
    author_id: HUMAN_ID,
    author_kind: 'human',
    occurred_at_ms: 1_800_000_000_000 - sequence * 1000,
    text: 'synthetic capture ' + sequence,
    tags: ['synthetic', 'history'],
    digest: digest(eventId),
    local_seq: sequence,
    originals: [],
    fixture_extension: { retained: true },
    ...options,
  };
}

function correction(sequence: number) {
  const eventId = uuid('20000000', sequence);
  return {
    record: {
      event_id: eventId,
      profile_id: PROFILE_ID,
      device_id: DEVICE_ID,
      author_id: HUMAN_ID,
      author_kind: 'human',
      occurred_at_ms: 1_800_000_000_000 - sequence * 1000,
      target_event_id: uuid('10000000', Math.max(1, sequence - 101)),
      target_digest: digest('target-' + sequence),
      corrected_text: 'synthetic correction ' + sequence,
      digest: digest(eventId),
      local_seq: sequence,
    },
    target_state: 'digest_matches',
  };
}

const BLOCK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function timeblockNode(sequence: number, action: Record<string, unknown>) {
  const eventId = uuid('30000000', sequence);
  return {
    event_id: eventId,
    profile_id: PROFILE_ID,
    device_id: DEVICE_ID,
    source: { kind: 'human', author_id: HUMAN_ID, owner_generation: null },
    parents: [],
    occurred_at_ms: 1_800_000_000_000 - sequence * 1000,
    effective_at_ms: 1_800_000_000_000 - sequence * 1000,
    clock: { epoch_id: 'synthetic-epoch', elapsed_ms: sequence * 1000 },
    payload: { kind: 'action', action },
    digest: digest(eventId),
    local_seq: sequence,
  };
}
function currentTimeblock(phase: 'running' | 'paused' | 'feedback_pending' | 'completed') {
  return {
    profile_id: PROFILE_ID,
    revision: 'synthetic-revision-' + phase,
    heads: [],
    active: {
      block_id: BLOCK_ID,
      name: 'Synthetic monitor block',
      note: '',
      timer: { mode: 'count_up' },
      phase,
      work_ms: 120_000,
      deadline_reached: false,
      deadline: null,
    },
    pending_feedback: phase === 'feedback_pending' ? [BLOCK_ID] : [],
    clock: {
      server_now_ms: 1_800_000_000_000,
      epoch_changed: false,
      wall_clock_moved_back: false,
    },
  };
}

function emptyPage(call: Call, response: ServerResponse, highwater: number) {
  page(call, response, [], highwater);
}

function pageAtFixedSnapshot(call: Call, response: ServerResponse, items: any[], latestHighwater: number) {
  const requestedThrough = call.url.searchParams.get('through');
  const through = requestedThrough === null ? latestHighwater : Number(requestedThrough);
  const beforeValue = call.url.searchParams.get('before');
  const before = beforeValue === null ? Number.MAX_SAFE_INTEGER : Number(beforeValue);
  const limit = Math.min(100, Math.max(1, Number(call.url.searchParams.get('limit') ?? '100')));
  const remaining = items.filter((item) => sequenceOf(item) <= through && sequenceOf(item) < before);
  const itemsInPage = remaining.slice(0, limit);
  const nextBefore = remaining.length > itemsInPage.length ? sequenceOf(itemsInPage[itemsInPage.length - 1]) : null;
  json(response, { items: itemsInPage, next_before: nextBefore, highwater: through });
}

function typedSummaryItem(
  sequence: number,
  kind: 'summary/1' | 'agent_summary/1',
  overrides: Record<string, any> = {},
) {
  const eventId = uuid(kind === 'summary/1' ? '40000000' : '50000000', sequence);
  const record =
    kind === 'summary/1'
      ? {
          event_id: eventId,
          profile_id: PROFILE_ID,
          device_id: DEVICE_ID,
          author_id: DEVICE_ID,
          task_id: uuid('41000000', sequence),
          run_id: uuid('42000000', sequence),
          attempt_id: uuid('43000000', sequence),
          artifact_kind: 'daily',
          snapshot: { through: Math.max(0, sequence - 1), source_kind: 'local_summary' },
          output: { narrative: 'model summary ' + sequence, evidence: [], read_original_ids: [] },
          supersedes_artifact_id: null,
          occurred_at_ms: 1_800_000_000_000 - sequence * 1000,
          digest: digest('summary:' + sequence),
          local_seq: sequence,
          source_extension: { raw: true },
        }
      : {
          event_id: eventId,
          profile_id: PROFILE_ID,
          device_id: DEVICE_ID,
          producer_agent_id: AGENT_ID,
          occurred_at_ms: 1_800_000_000_000 - sequence * 1000,
          snapshot: { source_kind: 'external_agent', external: true },
          narrative: 'external summary ' + sequence,
          evidence: [],
          digest: digest('agent-summary:' + sequence),
          local_seq: sequence,
          source_extension: { raw: true },
        };
  return { kind, record: { ...record, ...overrides } };
}

function noLegacyPaths(calls: Call[]) {
  return calls.filter((call) => /\/(?:health|version|act\/|eventlog)(?:\/|$)/.test(call.url.pathname));
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = realpathSync(directory);
    const isOwnedMonitorDirectory = ['exomind-beta-monitor-no-handoff-', 'exomind-beta-monitor-boundary-'].some((prefix) => basename(resolved).startsWith(prefix));
    if (dirname(resolved) !== realpathSync(tmpdir()) || !isOwnedMonitorDirectory) {
      throw new Error('Refuse to clean an unowned Beta monitor test directory');
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe('production Beta monitor adapter contract', () => {
  it('requires the exact Native handoff and explicit target; never discovers owner credentials', async () => {
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      const identity = await monitor.connect();
      expect(identity).toMatchObject({
        protocol: 'exomind-beta/1',
        runtimeId: RUNTIME_ID,
        deviceId: DEVICE_ID,
        profileId: PROFILE_ID,
        grantKind: 'observer',
      });
      expect(host.calls.map((call) => [call.method, call.url.pathname])).toEqual([
        ['GET', '/beta/v1/hello'],
        ['POST', '/beta/v1/profiles/' + PROFILE_ID + '/access/check'],
      ]);
      expect(host.calls[0]?.headers.authorization).toBeUndefined();
      expect(host.calls[1]?.headers.authorization).toBe('Bearer ' + TOKEN);
      expect(noLegacyPaths(host.calls)).toEqual([]);
      expect(host.calls.some((call) => call.url.pathname === '/beta/v1/profiles')).toBe(false);
    } finally {
      await monitor.stop();
    }

    const fetchImpl = vi.fn(async () => {
      throw new Error('invalid handoff must fail before HTTP');
    });
    const ownerDescriptor = {
      protocol: 'exomind-beta/1',
      url: host.apiBaseUrl,
      owner_token: TOKEN,
    };
    const invalid = create({
      handoff: ownerDescriptor,
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
      fetchImpl,
    });
    await expect(invalid.connect()).rejects.toMatchObject({ code: 'invalid_handoff' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const human = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'human' }),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
      fetchImpl,
    });
    await expect(human.connect()).rejects.toMatchObject({ code: 'human_grant_forbidden' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const profileMismatch = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl, { profileId: OTHER_PROFILE_ID }),
      stateStore: memoryStateStore(),
      fetchImpl,
    });
    await expect(profileMismatch.connect()).rejects.toMatchObject({ code: 'profile_handoff_mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();

    for (const incompleteTarget of [
      { apiBaseUrl: host.apiBaseUrl, profileId: PROFILE_ID },
      { runtimeId: RUNTIME_ID, profileId: PROFILE_ID },
      { apiBaseUrl: host.apiBaseUrl, runtimeId: RUNTIME_ID },
    ]) {
      const incomplete = create({
        handoff: nativeHandoff(host.apiBaseUrl),
        target: incompleteTarget,
        stateStore: memoryStateStore(),
        fetchImpl,
      });
      await expect(incomplete.connect()).rejects.toMatchObject({ code: 'explicit_target_required' });
    }

    const unsafeEndpoint = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target('http://owner@127.0.0.1:1/beta/v1'),
      stateStore: memoryStateStore(),
      fetchImpl,
    });
    await expect(unsafeEndpoint.connect()).rejects.toMatchObject({ code: 'invalid_endpoint' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not cross-fallback when Beta hello has a legacy or unsupported protocol', async () => {
    const host = await startHost((call, response) => {
      if (call.method === 'GET' && call.url.pathname === '/beta/v1/hello') {
        json(response, {
          protocol: 'exomind-runtime/0.5',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          running: true,
        });
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });
    await expect(monitor.connect()).rejects.toMatchObject({ code: 'protocol_mismatch' });
    expect(host.calls.map((call) => call.url.pathname)).toEqual(['/beta/v1/hello']);
    expect(noLegacyPaths(host.calls)).toEqual([]);
  });
  it('returns every paginated capture, correction and timeblock node with Agent messages intact', async () => {
    const videoBytes = Buffer.alloc(262145, 0x5a);
    const videoHash = createHash('sha256').update(videoBytes).digest('hex');
    const videoReference = {
      original_id: VIDEO_ID,
      sha256: videoHash,
      byte_length: videoBytes.length,
      file_name: 'synthetic-video.mp4',
      media_type: 'video/mp4',
    };
    const captures = Array.from({ length: 101 }, (_, index) => {
      const sequence = 101 - index;
      return capture(sequence, sequence === 100
        ? {
            author_id: AGENT_ID,
            author_kind: 'agent_note',
            text: 'synthetic agent note',
            originals: [videoReference],
          }
        : {});
    });
    const corrections = Array.from({ length: 101 }, (_, index) => correction(202 - index));
    const nodes = [
      timeblockNode(304, {
        kind: 'start',
        block_id: BLOCK_ID,
        name: 'Synthetic monitor block',
        note: '',
        timer: { mode: 'count_up' },
      }),
      timeblockNode(303, { kind: 'end_action', block_id: BLOCK_ID }),
      timeblockNode(302, {
        kind: 'submit_feedback',
        block_id: BLOCK_ID,
        feedback: { kind: 'text', text: 'synthetic feedback complete' },
      }),
      timeblockNode(301, { kind: 'append_feedback', block_id: BLOCK_ID, text: 'synthetic addition' }),
    ];
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      if (call.method === 'GET' && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/events') {
        page(call, response, captures, 304);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/corrections') {
        page(call, response, corrections, 304);
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/timeblocks/nodes') {
        page(call, response, nodes, 304);
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/timeblocks/current') {
        json(response, currentTimeblock('completed'));
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/originals/' + VIDEO_ID + '/bytes') {
        const offset = Number(call.url.searchParams.get('offset'));
        const length = Number(call.url.searchParams.get('length'));
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(videoBytes.subarray(offset, offset + length));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      await monitor.connect();
      const snapshot = await monitor.readHistory();
      expect(snapshot.feeds.captures.complete).toBe(true);
      expect(snapshot.feeds.captures.pages).toHaveLength(2);
      expect(snapshot.feeds.captures.records).toEqual(captures);
      expect(snapshot.feeds.corrections.complete).toBe(true);
      expect(snapshot.feeds.corrections.pages).toHaveLength(2);
      expect(snapshot.feeds.corrections.records).toEqual(corrections);
      expect(snapshot.timeblocks.nodes.records).toEqual(nodes);
      expect(snapshot.timeblocks.current.active.phase).toBe('completed');
      expect(snapshot.agentMessages).toEqual([captures.find((item) => item.author_kind === 'agent_note')]);
      expect(snapshot.agentMessages[0]?.text).toBe('synthetic agent note');
      expect(snapshot.through).toBe(304);
      expect(snapshot.cursor.complete).toBe(true);
      expect(snapshot).not.toHaveProperty('feeds.summaries');
      expect(snapshot).not.toHaveProperty('feeds.agentSummaries');
      expect(host.calls.some((call) => call.url.pathname.endsWith('/timeline'))).toBe(false);

      const accessCheck = host.calls.find((call) => call.url.pathname.endsWith('/access/check'));
      const requiredCapabilities = (accessCheck?.body as any).required;
      expect(requiredCapabilities).toEqual(expect.arrayContaining(READ_CAPABILITIES));
      expect(requiredCapabilities).toHaveLength(READ_CAPABILITIES.length);
      expect(requiredCapabilities).not.toContain('correction_source');
      expect((accessCheck?.body as any).required).not.toContain('summaries_read');
      expect((accessCheck?.body as any).required).not.toContain('orig_lifecycle_read');

      const captureSecondPage = host.calls.find((call) =>
        call.url.pathname.endsWith('/events') && call.url.searchParams.has('before'));
      const correctionSecondPage = host.calls.find((call) =>
        call.url.pathname.endsWith('/corrections') && call.url.searchParams.has('before'));
      expect(captureSecondPage?.url.searchParams.get('through')).toBe('304');
      expect(captureSecondPage?.url.searchParams.get('before')).toBe('2');
      expect(correctionSecondPage?.url.searchParams.get('through')).toBe('304');
      expect(correctionSecondPage?.url.searchParams.get('before')).toBe('103');
      expect(host.calls.some((call) => call.url.searchParams.get('before') === '0')).toBe(false);
      expect(host.calls.some((call) => call.url.pathname.includes('/export-bundle'))).toBe(false);
      expect(host.calls.some((call) => call.url.pathname.includes('/summaries'))).toBe(false);
      expect(host.calls.some((call) => /\/corrections\/[^/]+$/.test(call.url.pathname))).toBe(false);

      const metadata = await monitor.readOriginal(VIDEO_ID);
      expect(metadata.metadata).toEqual(videoReference);
      expect(metadata.bytes).toBeNull();
      expect(host.calls.some((call) => call.url.pathname.endsWith('/bytes'))).toBe(false);

      const original = await monitor.readOriginal(VIDEO_ID, { includeBytes: true });
      expect(original.metadata).toEqual(videoReference);
      expect(original.byteLength).toBe(videoBytes.length);
      expect(original.sha256).toBe(videoHash);
      expect(Buffer.from(original.bytes)).toEqual(videoBytes);
      expect(host.calls.filter((call) => call.url.pathname.endsWith('/bytes'))).toHaveLength(2);
      expect(host.calls.every((call) => !call.url.pathname.includes('/preview'))).toBe(true);
    } finally {
      await monitor.stop();
    }
  });

  it('keeps end_action feedback_pending separate from submit_feedback completion', async () => {
    let highwater = 20;
    let phase: 'feedback_pending' | 'completed' = 'feedback_pending';
    let nodes = [timeblockNode(20, { kind: 'end_action', block_id: BLOCK_ID })];
    let waitCount = 0;
    let firstStopped = false;
    const completedNode = timeblockNode(21, {
      kind: 'submit_feedback',
      block_id: BLOCK_ID,
      feedback: { kind: 'text', text: 'feedback submitted' },
    });
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      if (call.method === 'GET' && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/events') {
        emptyPage(call, response, highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/corrections') {
        emptyPage(call, response, highwater);
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/timeblocks/nodes') {
        page(call, response, nodes, highwater);
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/timeblocks/current') {
        json(response, currentTimeblock(phase));
        return;
      }
      if (call.method === 'POST'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/wait') {
        const body = call.body as any;
        if (waitCount++ === 0) {
          highwater = 21;
          phase = 'completed';
          nodes = [completedNode, ...nodes];
          json(response, {
            profile_id: PROFILE_ID,
            after_local_seq: body.after_local_seq,
            state: 'changed',
            highwater,
          });
        } else {
          json(response, {
            profile_id: PROFILE_ID,
            after_local_seq: body.after_local_seq,
            state: 'timeout',
            highwater,
          });
        }
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const store = memoryStateStore();
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: store,
    });

    try {
      await monitor.connect();
      const pending = await monitor.readHistory();
      expect(pending.timeblocks.current.active.phase).toBe('feedback_pending');
      expect(pending.timeblocks.nodes.records[0]?.payload.action.kind).toBe('end_action');
      expect(pending.timeblocks.nodes.records.some((item: any) =>
        item.payload.action.kind === 'submit_feedback')).toBe(false);
      expect(pending).not.toHaveProperty('timeblock_ended');

      await expect(monitor.wait({ timeoutMs: 30001 }))
        .rejects.toMatchObject({ code: 'wait_timeout_out_of_range' });
      expect(host.calls.some((call) => call.url.pathname.endsWith('/wait'))).toBe(false);

      const caughtUp = await monitor.wait({ timeoutMs: 30000 });
      expect(caughtUp.timeblocks.current.active.phase).toBe('completed');
      expect(caughtUp.timeblocks.nodes.records.some((item: any) =>
        item.payload.action.kind === 'submit_feedback')).toBe(true);
      expect(caughtUp).not.toHaveProperty('timeblock_ended');
      const waitRequest = host.calls.find((call) => call.url.pathname.endsWith('/wait'));
      expect((waitRequest?.body as any).timeout_ms).toBe(30000);
      expect((waitRequest?.body as any).after_local_seq).toBe(20);

      await monitor.stop();
      firstStopped = true;
      const restarted = create({
        handoff: nativeHandoff(host.apiBaseUrl),
        target: target(host.apiBaseUrl),
        stateStore: store,
      });
      await restarted.connect();
      const timeout = await restarted.wait({ timeoutMs: 30000 });
      expect(timeout.result).toBe('timeout');
      const waitRequests = host.calls.filter((call) => call.url.pathname.endsWith('/wait'));
      expect((waitRequests[1]?.body as any).after_local_seq).toBe(21);
      await restarted.stop();
    } finally {
      if (!firstStopped) await monitor.stop();
    }
  });

  it('cancels owned waits, bounds concurrency at four, and stop never registers grants', async () => {
    let activeWaits = 0;
    let closeAllWaits = deferred();
    const firstWaitStarted = deferred();
    const fourthWaitStarted = deferred();
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      if (call.method === 'POST'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/wait') {
        activeWaits += 1;
        if (activeWaits === 1) firstWaitStarted.resolve();
        if (activeWaits === 4) fourthWaitStarted.resolve();
        if (activeWaits > 4) {
          activeWaits -= 1;
          json(response, { error: { code: 'agent_wait_busy' } }, 429);
          return;
        }
        return new Promise<void>((resolveWait) => {
          response.once('close', () => {
            activeWaits -= 1;
            if (activeWaits === 0) closeAllWaits.resolve();
            resolveWait();
          });
        });
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });
    await monitor.connect();

    const cancelled = new AbortController();
    const cancelledWait = monitor.wait({ timeoutMs: 30000, signal: cancelled.signal });
    await firstWaitStarted.promise;
    cancelled.abort();
    await expect(cancelledWait).rejects.toMatchObject({ code: 'wait_cancelled' });
    await closeAllWaits.promise;

    closeAllWaits = deferred();
    const active = Array.from({ length: 4 }, () => monitor.wait({ timeoutMs: 30000 }));
    await fourthWaitStarted.promise;
    await expect(monitor.wait({ timeoutMs: 30000 }))
      .rejects.toMatchObject({ code: 'wait_concurrency_limit' });
    await monitor.stop();
    await Promise.allSettled(active);
    await closeAllWaits.promise;
    expect(activeWaits).toBe(0);
    expect(host.calls.filter((call) => call.url.pathname.endsWith('/wait'))).toHaveLength(5);
    expect(host.calls.some((call) => call.url.pathname.endsWith('/grants'))).toBe(false);
    expect(host.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('queries a fixed receipt after a lost write response and never reposts after restart', async () => {
    let receiptAvailable = false;
    let postedCommand: any = null;
    let capturePosts = 0;
    const eventDigest = digest('accepted-agent-note');
    const agentMessage = {
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      device_id: DEVICE_ID,
      author_id: AGENT_ID,
      author_kind: 'agent_note',
      occurred_at_ms: 1_800_000_000_000,
      text: 'synthetic agent note',
      tags: ['synthetic'],
      digest: eventDigest,
      local_seq: 41,
      originals: [],
    };
    const receipt = {
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      local_seq: 41,
      event_digest: eventDigest,
      durability: 'local_committed',
      replayed: false,
    };
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response, { grantKind: 'agent_note', agentId: AGENT_ID })) return;
      if (call.method === 'POST' && call.url.pathname === '/beta/v1/capture') {
        capturePosts += 1;
        postedCommand = call.body;
        response.destroy();
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/receipts/' + COMMAND_ID) {
        if (!receiptAvailable) {
          json(response, { error: { code: 'not_found' } }, 404);
        } else {
          json(response, receipt);
        }
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/timeline/events/' + EVENT_ID) {
        json(response, { kind: 'capture', record: agentMessage });
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const store = memoryStateStore();
    const create = await loadFactory();
    const command = {
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      occurred_at_ms: 1_800_000_000_000,
      text: 'synthetic agent note',
      tags: ['synthetic'],
      originals: [],
    };
    const first = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: store,
    });
    await first.connect();
    const unknown = await first.sendAgentNote(command);
    expect(unknown.result).toBe('unknown');
    expect(capturePosts).toBe(1);
    expect((postedCommand as any).command_id).toBe(COMMAND_ID);
    expect((postedCommand as any).event_id).toBe(EVENT_ID);
    expect(JSON.stringify([...store.values.values()])).not.toContain(TOKEN);

    await first.stop();
    receiptAvailable = true;
    const restarted = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: store,
    });
    await restarted.connect();
    const confirmed = await restarted.sendAgentNote(command);
    expect(confirmed.result).toBe('confirmed');
    const writeAccessChecks = host.calls.filter((call) => call.url.pathname.endsWith('/access/check'));
    expect(writeAccessChecks.some((call) => {
      const required = (call.body as any).required;
      return required.includes('capture_append_agent_note') && required.includes('timeline_read');
    })).toBe(true);
    expect(capturePosts).toBe(1);
    expect(host.calls.filter((call) => call.url.pathname.endsWith('/receipts/' + COMMAND_ID))).toHaveLength(2);
    expect(host.calls.some((call) => call.url.pathname.endsWith('/receipts/' + EVENT_ID))).toBe(false);
    expect(host.calls.some((call) => call.url.pathname.endsWith('/timeline/events/' + EVENT_ID))).toBe(true);
    expect(host.calls.some((call) => call.url.pathname.endsWith('/grants'))).toBe(false);
    await restarted.stop();
  });

  it('reuses an old grant on a new endpoint only after explicit identity qualification', async () => {
    const oldHost = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      if (call.method === 'GET' && (
        call.url.pathname.endsWith('/events')
        || call.url.pathname.endsWith('/corrections')
        || call.url.pathname.endsWith('/timeblocks/nodes')
      )) {
        emptyPage(call, response, 10);
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/timeblocks/current')) {
        json(response, {
          profile_id: PROFILE_ID,
          revision: 'old',
          active: null,
          heads: [],
          pending_feedback: [],
          clock: { server_now_ms: 1, epoch_changed: false, wall_clock_moved_back: false },
        });
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const newHost = await startHost((call, response) => {
      if (replyIdentity(call, response)) {
        if (call.url.pathname.endsWith('/access/check')) {
          expect(call.headers.authorization).toBe('Bearer ' + TOKEN);
        }
        return;
      }
      if (call.method === 'POST' && call.url.pathname.endsWith('/wait')) {
        const body = call.body as any;
        json(response, {
          profile_id: PROFILE_ID,
          after_local_seq: body.after_local_seq,
          state: 'timeout',
          highwater: 10,
        });
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const wrongRuntimeHost = await startHost((call, response) => {
      if (call.method === 'GET' && call.url.pathname === '/beta/v1/hello') {
        json(response, {
          protocol: 'exomind-beta/1',
          runtime_id: OTHER_PROFILE_ID,
          device_id: DEVICE_ID,
          running: true,
        });
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });

    const store = memoryStateStore();
    const create = await loadFactory();
    const first = create({
      handoff: nativeHandoff(oldHost.apiBaseUrl),
      target: target(oldHost.apiBaseUrl),
      stateStore: store,
    });
    await first.connect();
    await first.readHistory();
    await first.stop();

    const profileMismatch = create({
      handoff: nativeHandoff(oldHost.apiBaseUrl),
      target: target(newHost.apiBaseUrl, { profileId: OTHER_PROFILE_ID }),
      stateStore: store,
    });
    await expect(profileMismatch.connect())
      .rejects.toMatchObject({ code: 'profile_handoff_mismatch' });
    expect(newHost.calls).toHaveLength(0);

    const badRuntime = create({
      handoff: nativeHandoff(oldHost.apiBaseUrl),
      target: target(wrongRuntimeHost.apiBaseUrl),
      stateStore: store,
    });
    await expect(badRuntime.connect())
      .rejects.toMatchObject({ code: 'runtime_or_device_mismatch' });
    expect(wrongRuntimeHost.calls.map((call) => call.url.pathname)).toEqual(['/beta/v1/hello']);

    const second = create({
      handoff: nativeHandoff(oldHost.apiBaseUrl),
      target: target(newHost.apiBaseUrl),
      stateStore: store,
    });
    await second.connect();
    const result = await second.wait({ timeoutMs: 1000 });
    expect(result.result).toBe('timeout');
    expect((newHost.calls.find((call) => call.url.pathname.endsWith('/wait'))?.body as any)
      .after_local_seq).toBe(10);
    expect(newHost.calls.some((call) => call.url.pathname.endsWith('/grants'))).toBe(false);
    expect(newHost.calls.some((call) => call.method === 'DELETE')).toBe(false);
    await second.stop();
  });

  it('continues maxPages=1 from the saved next_before and keeps each partial result incomplete', async () => {
    const captures = Array.from({ length: 201 }, (_unused, index) => capture(201 - index));
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      if (call.method === 'GET' && call.url.pathname.endsWith('/events')) {
        page(call, response, captures, 201);
        return;
      }
      if (call.method === 'GET' && (
        call.url.pathname.endsWith('/corrections')
        || call.url.pathname.endsWith('/timeblocks/nodes')
      )) {
        emptyPage(call, response, 201);
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/timeblocks/current')) {
        json(response, currentTimeblock('completed'));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      await monitor.connect();
      const snapshots: any[] = [];
      const sequences: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        const snapshot = await monitor.readHistory({ maxPages: 1 });
        snapshots.push(snapshot);
        sequences.push(...snapshot.feeds.captures.records.map(sequenceOf));
        expect(snapshot.feeds.captures.pages).toHaveLength(1);
        expect(snapshot.feeds.captures.complete).toBe(index === 2);
        expect(snapshot.cursor.complete).toBe(index === 2);
        if (index < 2) expect(snapshot.feeds.captures.records).toHaveLength(100);
      }

      expect(sequences).toEqual(captures.map(sequenceOf));
      expect(new Set(sequences).size).toBe(201);
      expect(snapshots[1]?.feeds.captures.records.map(sequenceOf)).toEqual(
        captures.slice(100, 200).map(sequenceOf),
      );
      const eventReads = host.calls.filter((call) =>
        call.method === 'GET' && call.url.pathname.endsWith('/events'));
      expect(eventReads.map((call) => call.url.searchParams.get('before'))).toEqual([
        null,
        '102',
        '2',
      ]);
      expect(eventReads.map((call) => call.url.searchParams.get('through'))).toEqual([
        null,
        '201',
        '201',
      ]);
      expect(snapshots[1]?.cursor.complete).toBe(false);
      expect(snapshots[2]?.cursor.after_local_seq).toBe(201);
    } finally {
      await monitor.stop();
    }
  });

  it('qualifies an explicit R2 runtime before recovering only fixed unknown IDs and rebuilding its cursor', async () => {
    const nextRuntimeId = '33333333-3333-4333-8333-333333333334';
    const directory = mkdtempSync(join(tmpdir(), 'exomind-beta-monitor-boundary-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'monitor-state.json');
    const command = {
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      occurred_at_ms: 1_800_000_000_000,
      text: 'restart-safe synthetic note',
      tags: ['synthetic'],
      originals: [],
    };
    const eventDigest = digest(command.text);
    const agentMessage = {
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      device_id: DEVICE_ID,
      author_id: AGENT_ID,
      author_kind: 'agent_note',
      occurred_at_ms: command.occurred_at_ms,
      text: command.text,
      tags: command.tags,
      digest: eventDigest,
      local_seq: 6,
      originals: [],
    };
    const receipt = {
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      local_seq: 6,
      event_digest: eventDigest,
      durability: 'local_committed',
      replayed: true,
    };
    let capturePosts = 0;
    const oldHost = await startHost((call, response) => {
      if (replyIdentity(call, response, {
        runtimeId: RUNTIME_ID,
        grantKind: 'agent_note',
        agentId: AGENT_ID,
      })) return;
      if (call.method === 'GET' && (
        call.url.pathname.endsWith('/events')
        || call.url.pathname.endsWith('/corrections')
        || call.url.pathname.endsWith('/timeblocks/nodes')
      )) {
        emptyPage(call, response, 20);
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/timeblocks/current')) {
        json(response, currentTimeblock('completed'));
        return;
      }
      if (call.method === 'POST' && call.url.pathname === '/beta/v1/capture') {
        capturePosts += 1;
        response.destroy();
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname.endsWith('/receipts/' + COMMAND_ID)) {
        json(response, { error: { code: 'not_found' } }, 404);
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const newHost = await startHost((call, response) => {
      if (replyIdentity(call, response, {
        runtimeId: nextRuntimeId,
        grantKind: 'agent_note',
        agentId: AGENT_ID,
      })) return;
      if (call.method === 'GET' && (
        call.url.pathname.endsWith('/events')
        || call.url.pathname.endsWith('/corrections')
        || call.url.pathname.endsWith('/timeblocks/nodes')
      )) {
        emptyPage(call, response, 5);
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/timeblocks/current')) {
        json(response, currentTimeblock('completed'));
        return;
      }
      if (call.method === 'POST' && call.url.pathname === '/beta/v1/capture') {
        capturePosts += 1;
        response.destroy();
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname.endsWith('/receipts/' + COMMAND_ID)) {
        json(response, receipt);
        return;
      }
      if (call.method === 'GET'
        && call.url.pathname.endsWith('/timeline/events/' + EVENT_ID)) {
        json(response, { kind: 'capture', record: agentMessage });
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const module = await import(adapterUrl.href);
    const create = module.createBetaMonitorAdapter;
    const store = module.createFileStateStore(statePath);
    const first = create({
      handoff: nativeHandoff(oldHost.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(oldHost.apiBaseUrl),
      stateStore: store,
    });
    const second = create({
      handoff: nativeHandoff(oldHost.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(newHost.apiBaseUrl, { runtimeId: nextRuntimeId }),
      stateStore: store,
    });

    try {
      await first.connect();
      const oldSnapshot = await first.readHistory();
      expect(oldSnapshot.cursor.after_local_seq).toBe(20);
      const unknown = await first.sendAgentNote(command);
      expect(unknown).toMatchObject({
        result: 'unknown',
        command_id: COMMAND_ID,
        event_id: EVENT_ID,
      });
      expect(capturePosts).toBe(1);
      await first.stop();

      await second.connect();
      expect(newHost.calls.some((call) =>
        call.method === 'GET' && call.url.pathname.endsWith('/hello'))).toBe(true);
      expect(newHost.calls.some((call) =>
        call.method === 'POST' && call.url.pathname.endsWith('/access/check'))).toBe(true);

      const rebuilt = await second.readHistory();
      expect(rebuilt.cursor.rebuilt).toBe(true);
      expect(rebuilt.cursor.after_local_seq).toBe(5);
      const firstR2Page = newHost.calls.find((call) =>
        call.method === 'GET' && call.url.pathname.endsWith('/events'));
      expect(firstR2Page?.url.searchParams.get('through')).toBeNull();

      const confirmed = await second.sendAgentNote(command);
      expect(confirmed).toMatchObject({
        result: 'confirmed',
        receipt: { command_id: COMMAND_ID, event_id: EVENT_ID },
      });
      expect(capturePosts).toBe(1);
      expect(newHost.calls.filter((call) =>
        call.method === 'POST' && call.url.pathname === '/beta/v1/capture')).toHaveLength(0);
      expect(newHost.calls.filter((call) =>
        call.method === 'GET' && call.url.pathname.endsWith('/receipts/' + COMMAND_ID))).toHaveLength(1);
      expect(newHost.calls.filter((call) =>
        call.method === 'GET' && call.url.pathname.endsWith('/timeline/events/' + EVENT_ID))).toHaveLength(1);
      const r2Access = newHost.calls.find((call) =>
        call.method === 'POST' && call.url.pathname.endsWith('/access/check'));
      expect(r2Access?.headers.authorization).toBe('Bearer ' + TOKEN);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  it('rejects a 2 KiB buffered original against a 1 KiB caller budget and streams larger bytes with SHA-256', async () => {
    const smallId = VIDEO_ID;
    const largeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const smallBytes = Buffer.alloc(2048, 0x31);
    const largeBytes = Buffer.alloc(300 * 1024, 0x62);
    const smallReference = {
      original_id: smallId,
      sha256: createHash('sha256').update(smallBytes).digest('hex'),
      byte_length: smallBytes.byteLength,
      file_name: 'small.bin',
      media_type: 'application/octet-stream',
      state: 'ready',
    };
    const largeReference = {
      original_id: largeId,
      sha256: createHash('sha256').update(largeBytes).digest('hex'),
      byte_length: largeBytes.byteLength,
      file_name: 'large.bin',
      media_type: 'application/octet-stream',
      state: 'ready',
    };
    const captures = [capture(10, { originals: [smallReference, largeReference] })];
    const rangeCalls: Array<{ id: string; offset: number; length: number }> = [];
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      if (call.method === 'GET' && call.url.pathname.endsWith('/events')) {
        page(call, response, captures, 10);
        return;
      }
      if (call.method === 'GET' && (
        call.url.pathname.endsWith('/corrections')
        || call.url.pathname.endsWith('/timeblocks/nodes')
      )) {
        emptyPage(call, response, 10);
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/timeblocks/current')) {
        json(response, currentTimeblock('completed'));
        return;
      }
      if (call.method === 'GET' && (
        call.url.pathname.endsWith('/originals/' + smallId + '/bytes')
        || call.url.pathname.endsWith('/originals/' + largeId + '/bytes')
      )) {
        const id = call.url.pathname.includes('/originals/' + smallId + '/')
          ? smallId
          : largeId;
        const offset = Number(call.url.searchParams.get('offset'));
        const length = Number(call.url.searchParams.get('length'));
        rangeCalls.push({ id, offset, length });
        const source = id === smallId ? smallBytes : largeBytes;
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(source.subarray(offset, offset + length));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      await monitor.connect();
      await monitor.readHistory();
      await expect(monitor.readOriginal(smallId, {
        includeBytes: true,
        maxBufferedBytes: 1024,
      })).rejects.toMatchObject({ code: 'original_buffer_budget_exceeded' });
      expect(rangeCalls).toHaveLength(0);

      const buffered = await monitor.readOriginal(smallId, {
        includeBytes: true,
        maxBufferedBytes: smallBytes.byteLength,
      });
      expect(Buffer.from(buffered.bytes)).toEqual(smallBytes);
      expect(buffered.sha256).toBe(smallReference.sha256);
      expect(rangeCalls.filter((call) => call.id === smallId)).toHaveLength(1);

      const streamedChunks: Buffer[] = [];
      const streamed = await monitor.streamOriginal(largeId, {
        onChunk: (chunk: Uint8Array) => streamedChunks.push(Buffer.from(chunk)),
      });
      expect(streamed.metadata).toEqual(largeReference);
      expect(streamed.byteLength).toBe(largeBytes.byteLength);
      expect(streamed.sha256).toBe(largeReference.sha256);
      expect(streamed).not.toHaveProperty('bytes');
      expect(streamedChunks.length).toBeGreaterThan(1);
      expect(Buffer.concat(streamedChunks)).toEqual(largeBytes);
      expect(createHash('sha256').update(Buffer.concat(streamedChunks)).digest('hex'))
        .toBe(largeReference.sha256);
    } finally {
      await monitor.stop();
    }
  });

  it('stop aborts an in-flight non-Wait GET before it can persist a late page', async () => {
    const eventStarted = deferred<void>();
    const store = memoryStateStore();
    const originalSave = store.save.bind(store);
    let saves = 0;
    store.save = async (key, value) => {
      saves += 1;
      await originalSave(key, value);
    };
    let eventSignal: AbortSignal | undefined;
    let releaseEvent: (() => void) | undefined;
    const fetchImpl = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/events')) {
        eventSignal = init.signal ?? undefined;
        eventStarted.resolve();
        return new Promise<Response>((resolveResponse, rejectResponse) => {
          releaseEvent = () => resolveResponse(new Response(
            JSON.stringify({ items: [], next_before: null, highwater: 0 }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ));
          eventSignal?.addEventListener('abort', () => {
            rejectResponse(new DOMException('The request was aborted', 'AbortError'));
          }, { once: true });
        });
      }
      return fetch(input, init);
    };
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: store,
      fetchImpl,
    });

    try {
      await monitor.connect();
      const savesAtStart = saves;
      const reading = monitor.readHistory();
      const outcomePromise = Promise.allSettled([reading]);
      await eventStarted.promise;
      await monitor.stop();
      if (!eventSignal?.aborted) releaseEvent?.();
      const [outcome] = await outcomePromise;

      expect(eventSignal?.aborted).toBe(true);
      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: { code: 'request_cancelled' },
      });
      expect(saves).toBe(savesAtStart);
    } finally {
      await monitor.stop();
    }
  });

  it('atomically reserves one unresolved agent_note across adapters sharing a state journal', async () => {
    const store = memoryStateStore();
    (store as any).reservePendingCommand = async (key: string, pending: any) => {
      const current = store.values.get(key) ?? {
        version: 1,
        cursor: 0,
        feeds: {},
        seen: {},
        pendingWait: false,
        pendingCommand: null,
      };
      const existing = current.pendingCommand;
      if (existing && existing.status !== 'confirmed'
        && (existing.commandId !== pending.commandId
          || existing.eventId !== pending.eventId
          || existing.payloadDigest !== pending.payloadDigest)) {
        throw Object.assign(new Error('An unresolved command already owns this scope.'), {
          code: 'unresolved_command_exists',
        });
      }
      store.values.set(key, JSON.parse(JSON.stringify({
        ...current,
        pendingCommand: pending,
      })));
    };

    const accessGates: Array<() => void> = [];
    let holdWriteCapabilities = true;
    const makeWriteAccessResponse = () => new Response(JSON.stringify({
      protocol: 'exomind-beta/1',
      runtime_id: RUNTIME_ID,
      device_id: DEVICE_ID,
      profile_id: PROFILE_ID,
      grant_kind: 'agent_note',
      agent_id: AGENT_ID,
      allowed: [
        ...READ_CAPABILITIES,
        'capture_append_agent_note',
        'timeline_read',
      ],
      max_original_chunk_bytes: 262144,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access/check')) {
        const body = JSON.parse(String(init.body ?? '{}'));
        if (body.required?.includes('capture_append_agent_note') && holdWriteCapabilities) {
          return new Promise<Response>((resolveResponse) => {
            accessGates.push(() => resolveResponse(makeWriteAccessResponse()));
          });
        }
      }
      return fetch(input, init);
    };
    const posted: Call[] = [];
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response, {
        grantKind: 'agent_note',
        agentId: AGENT_ID,
      })) return;
      if (call.method === 'POST' && call.url.pathname === '/beta/v1/capture') {
        posted.push(call);
        response.destroy();
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/receipts/' + COMMAND_ID)) {
        json(response, { error: { code: 'not_found' } }, 404);
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/receipts/' + OTHER_PROFILE_ID)) {
        json(response, { error: { code: 'not_found' } }, 404);
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const first = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: store,
      fetchImpl,
    });
    const second = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: store,
      fetchImpl,
    });
    const commandA = {
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      occurred_at_ms: 1_800_000_000_000,
      text: 'first concurrent synthetic note',
      tags: ['synthetic'],
      originals: [],
    };
    const commandB = {
      command_id: OTHER_PROFILE_ID,
      event_id: HUMAN_ID,
      profile_id: PROFILE_ID,
      occurred_at_ms: 1_800_000_000_001,
      text: 'second concurrent synthetic note',
      tags: ['synthetic'],
      originals: [],
    };

    try {
      await Promise.all([first.connect(), second.connect()]);
      const sendingA = first.sendAgentNote(commandA);
      const sendingB = second.sendAgentNote(commandB);
      await vi.waitFor(() => expect(accessGates).toHaveLength(2));
      const observedInterleavedCapabilities = accessGates.length;
      holdWriteCapabilities = false;
      for (const release of accessGates.splice(0)) release();

      const outcomes = await Promise.allSettled([sendingA, sendingB]);
      expect(observedInterleavedCapabilities).toBeGreaterThan(0);
      expect(posted).toHaveLength(1);
      const fulfilled = outcomes.filter((item) => item.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0]?.value.result).toBe('unknown');

      const journal = [...store.values.values()][0] as any;
      expect(journal?.pendingCommand?.status).toBe('unknown');
      expect(journal?.pendingCommand?.commandId).toBe((posted[0]?.body as any).command_id);
      expect(journal?.pendingCommand?.eventId).toBe((posted[0]?.body as any).event_id);
      expect(new Set(posted.map((call) => (call.body as any).command_id)).size).toBe(1);
    } finally {
      holdWriteCapabilities = false;
      for (const release of accessGates.splice(0)) release();
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  it('reserves one fixed agent_note across independent file stores sharing the same statePath', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'exomind-beta-monitor-boundary-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'monitor-state.json');
    const module = await import(adapterUrl.href);
    const firstStore = module.createFileStateStore(statePath);
    const secondStore = module.createFileStateStore(statePath);
    const reservationAttempts: Array<{ key: string; status?: string; code?: string }> = [];
    const observeReservation = (store: any) => {
      const reserve = store.reservePendingCommand.bind(store);
      store.reservePendingCommand = async (key: string, pending: any) => {
        try {
          const result = await reserve(key, pending);
          reservationAttempts.push({ key, status: result?.status });
          return result;
        } catch (error) {
          reservationAttempts.push({ key, code: (error as any)?.code });
          throw error;
        }
      };
    };
    observeReservation(firstStore);
    observeReservation(secondStore);

    const accessGates: Array<() => void> = [];
    let holdWriteCapabilities = true;
    const makeWriteAccessResponse = () => new Response(JSON.stringify({
      protocol: 'exomind-beta/1',
      runtime_id: RUNTIME_ID,
      device_id: DEVICE_ID,
      profile_id: PROFILE_ID,
      grant_kind: 'agent_note',
      agent_id: AGENT_ID,
      allowed: [
        ...READ_CAPABILITIES,
        'capture_append_agent_note',
        'timeline_read',
      ],
      max_original_chunk_bytes: 262144,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access/check')) {
        const body = JSON.parse(String(init.body ?? '{}'));
        if (body.required?.includes('capture_append_agent_note') && holdWriteCapabilities) {
          return new Promise<Response>((resolveResponse) => {
            accessGates.push(() => resolveResponse(makeWriteAccessResponse()));
          });
        }
      }
      return fetch(input, init);
    };
    const posted: Call[] = [];
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response, {
        grantKind: 'agent_note',
        agentId: AGENT_ID,
      })) return;
      if (call.method === 'POST' && call.url.pathname === '/beta/v1/capture') {
        posted.push(call);
        response.destroy();
        return;
      }
      if (call.method === 'GET' && call.url.pathname.endsWith('/receipts/' + COMMAND_ID)) {
        json(response, { error: { code: 'not_found' } }, 404);
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = module.createBetaMonitorAdapter;
    const first = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: firstStore,
      fetchImpl,
    });
    const second = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: secondStore,
      fetchImpl,
    });
    const command = {
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      occurred_at_ms: 1_800_000_000_000,
      text: 'one fixed command from two concurrent CLI owners',
      tags: ['synthetic'],
      originals: [],
    };

    try {
      await first.connect();
      await second.connect();
      const sendingA = first.sendAgentNote(command);
      const sendingB = second.sendAgentNote(command);
      await vi.waitFor(() => expect(accessGates).toHaveLength(2));
      holdWriteCapabilities = false;
      for (const release of accessGates.splice(0)) release();

      const outcomes = await Promise.allSettled([sendingA, sendingB]);
      expect(reservationAttempts).toHaveLength(2);
      expect(reservationAttempts.filter((attempt) => attempt.status === 'reserved')).toHaveLength(1);
      const competingAttempt = reservationAttempts.find((attempt) => attempt.status !== 'reserved');
      expect(['existing', 'journal_busy']).toContain(
        competingAttempt?.status ?? competingAttempt?.code,
      );
      expect(posted).toHaveLength(1);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect((outcome.reason as any)?.code).toBe('journal_busy');
        } else {
          expect(outcome.value).toMatchObject({
            result: 'unknown',
            command_id: COMMAND_ID,
            event_id: EVENT_ID,
          });
        }
      }
      const journal = await firstStore.load(reservationAttempts[0]!.key);
      expect(journal?.pendingCommand).toMatchObject({
        commandId: COMMAND_ID,
        eventId: EVENT_ID,
        status: 'unknown',
      });
    } finally {
      holdWriteCapabilities = false;
      for (const release of accessGates.splice(0)) release();
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  it('keeps a pending command when a second file store saves an older read', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'exomind-beta-monitor-boundary-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'monitor-state.json');
    const module = await import(adapterUrl.href);
    const firstStore = module.createFileStateStore(statePath);
    const secondStore = module.createFileStateStore(statePath);
    const key = 'file-journal-stale-save-follow-up';
    const initialState = {
      version: 1,
      cursor: 7,
      feeds: {},
      seen: {},
      pendingWait: false,
      pendingCommand: null,
      runtimeId: RUNTIME_ID,
      rebuildPending: false,
    };
    const pending = {
      commandId: COMMAND_ID,
      eventId: EVENT_ID,
      payloadDigest: digest('fixed stale-save fixture'),
      status: 'pending',
    };

    await firstStore.save(key, initialState);
    const staleRead = await firstStore.load(key);
    expect(staleRead?.pendingCommand).toBeNull();
    const reservation = await secondStore.reservePendingCommand(key, pending);
    expect(reservation.status).toBe('reserved');

    await firstStore.save(key, staleRead);

    const latest = await secondStore.load(key);
    expect(latest).toMatchObject({
      cursor: 7,
      pendingCommand: {
        commandId: COMMAND_ID,
        eventId: EVENT_ID,
        payloadDigest: pending.payloadDigest,
        status: 'pending',
      },
    });
  });

  it('reads 4,000 file-backed captures with a 1,024-item digest window and preserves a pending command', async () => {
    const captures = Array.from({ length: 4000 }, (_unused, index) =>
      capture(4000 - index, { text: 'complete synthetic body ' + (4000 - index) }));
    const directory = mkdtempSync(join(tmpdir(), 'exomind-beta-monitor-boundary-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'monitor-state.json');
    const endpoint = 'http://127.0.0.1:1/beta/v1';
    const responseJson = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    const fetchImpl = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/beta/v1/hello') {
        return responseJson({
          protocol: 'exomind-beta/1',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          running: true,
        });
      }
      if (method === 'POST' && url.pathname.endsWith('/access/check')) {
        return responseJson({
          protocol: 'exomind-beta/1',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          profile_id: PROFILE_ID,
          grant_kind: 'observer',
          agent_id: null,
          allowed: READ_CAPABILITIES,
          max_original_chunk_bytes: 262144,
        });
      }
      if (method === 'GET' && url.pathname.endsWith('/events')) {
        const beforeValue = url.searchParams.get('before');
        const before = beforeValue === null ? Number.MAX_SAFE_INTEGER : Number(beforeValue);
        const limit = Number(url.searchParams.get('limit') ?? '100');
        const remaining = captures.filter((item) => item.local_seq < before);
        const items = remaining.slice(0, limit);
        const nextBefore = remaining.length > items.length ? items[items.length - 1]?.local_seq ?? null : null;
        return responseJson({ items, next_before: nextBefore, highwater: 4000 });
      }
      if (method === 'GET' && (
        url.pathname.endsWith('/corrections')
        || url.pathname.endsWith('/timeblocks/nodes')
      )) {
        return responseJson({ items: [], next_before: null, highwater: 4000 });
      }
      if (method === 'GET' && url.pathname.endsWith('/timeblocks/current')) {
        return responseJson(currentTimeblock('completed'));
      }
      return responseJson({ error: { code: 'not_found' } }, 404);
    };
    const module = await import(adapterUrl.href);
    const store = module.createFileStateStore(statePath);
    let stateKey = '';
    const load = store.load.bind(store);
    store.load = async (key: string) => {
      stateKey = key;
      return load(key);
    };
    const monitor = module.createBetaMonitorAdapter({
      handoff: nativeHandoff(endpoint),
      target: target(endpoint),
      stateStore: store,
      fetchImpl,
    });
    const pending = {
      commandId: COMMAND_ID,
      eventId: EVENT_ID,
      payloadDigest: digest('history-budget pending command'),
      status: 'pending',
    };

    try {
      await monitor.connect();
      expect(stateKey).not.toBe('');
      const reservation = await store.reservePendingCommand(stateKey, pending);
      expect(reservation.status).toBe('reserved');

      const observed: any[] = [];
      for (let index = 0; index < 40; index += 1) {
        const snapshot = await monitor.readHistory({ maxPages: 1 });
        expect(snapshot.feeds.captures.pages).toHaveLength(1);
        expect(snapshot.feeds.captures.complete).toBe(index === 39);
        observed.push(...snapshot.feeds.captures.records);
        expect(statSync(statePath).size).toBeLessThanOrEqual(512 * 1024);
      }

      expect(observed).toHaveLength(4000);
      expect(observed.map((item) => [item.event_id, item.text])).toEqual(
        captures.map((item) => [item.event_id, item.text]),
      );
      expect(new Set(observed.map((item) => item.event_id)).size).toBe(4000);

      const latest = await store.load(stateKey);
      expect(latest?.pendingCommand).toMatchObject({
        commandId: COMMAND_ID,
        eventId: EVENT_ID,
        payloadDigest: pending.payloadDigest,
        status: 'pending',
      });
      expect(Object.keys(latest?.seen ?? {}).sort()).toEqual(
        captures.slice(-1024).map((item) => PROFILE_ID + ':' + item.event_id).sort(),
      );
    } finally {
      await monitor.stop();
    }
  });

  it('bounds streamed JSON reads, retries at an explicit caller budget, and preserves legal single captures', async () => {
    const endpoint = 'http://127.0.0.1:1/beta/v1';
    const responseBudget = 1024 * 1024;
    const chunkBytes = 64 * 1024;
    const responseJson = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    const controlFetch = (highwater: number) => (input: any) => {
      const url = new URL(String(input));
      if (url.pathname === '/beta/v1/hello') {
        return responseJson({
          protocol: 'exomind-beta/1',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          running: true,
        });
      }
      if (url.pathname.endsWith('/access/check')) {
        return responseJson({
          protocol: 'exomind-beta/1',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          profile_id: PROFILE_ID,
          grant_kind: 'observer',
          agent_id: null,
          allowed: READ_CAPABILITIES,
          max_original_chunk_bytes: 262144,
        });
      }
      if (url.pathname.endsWith('/corrections') || url.pathname.endsWith('/timeblocks/nodes')) {
        return responseJson({ items: [], next_before: null, highwater });
      }
      if (url.pathname.endsWith('/timeblocks/current')) {
        return responseJson(currentTimeblock('completed'));
      }
      return responseJson({ error: { code: 'not_found' } }, 404);
    };
    const streamJson = (
      bytes: Buffer,
      metrics: { bytesSent: number; cancelled: boolean; totalBytes: number },
    ) => {
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(bytes.byteLength, offset + chunkBytes);
          const chunk = bytes.subarray(offset, end);
          offset = end;
          metrics.bytesSent += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          metrics.cancelled = true;
        },
      }, { highWaterMark: 0 });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const makePage = (items: any[], highwater: number, url: URL) => {
      const beforeValue = url.searchParams.get('before');
      const before = beforeValue === null ? Number.MAX_SAFE_INTEGER : Number(beforeValue);
      const limit = Number(url.searchParams.get('limit') ?? '100');
      const remaining = items.filter((item) => sequenceOf(item) < before);
      const itemsInPage = remaining.slice(0, limit);
      const nextBefore = remaining.length > itemsInPage.length
        ? sequenceOf(itemsInPage[itemsInPage.length - 1])
        : null;
      return { items: itemsInPage, next_before: nextBefore, highwater };
    };
    const largeCaptures = Array.from({ length: 100 }, (_unused, index) =>
      capture(100 - index, { text: 'x'.repeat(12 * 1024) }));
    const store = memoryStateStore();
    const eventReads: Array<{ limit: number; before: string | null; through: string | null }> = [];
    const oversizedStreams: Array<{ bytesSent: number; cancelled: boolean; totalBytes: number }> = [];
    const cursorSnapshotsBeforeRetry: boolean[] = [];
    const baseFetch = controlFetch(100);
    const fetchImpl = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/events')) {
        const limit = Number(url.searchParams.get('limit') ?? '100');
        eventReads.push({
          limit,
          before: url.searchParams.get('before'),
          through: url.searchParams.get('through'),
        });
        if (eventReads.length > 1) {
          cursorSnapshotsBeforeRetry.push(
            [...store.values.values()].some((value: any) => value.feeds?.captures !== undefined),
          );
        }
        const pageValue = makePage(largeCaptures, 100, url);
        const bytes = Buffer.from(JSON.stringify(pageValue), 'utf8');
        if (bytes.byteLength > responseBudget) {
          const metrics = { bytesSent: 0, cancelled: false, totalBytes: bytes.byteLength };
          oversizedStreams.push(metrics);
          return streamJson(bytes, metrics);
        }
        return responseJson(pageValue);
      }
      return baseFetch(input, init);
    };
    const module = await import(adapterUrl.href);
    const monitor = module.createBetaMonitorAdapter({
      handoff: nativeHandoff(endpoint),
      target: target(endpoint),
      stateStore: store,
      fetchImpl,
    });

    try {
      await monitor.connect();
      const snapshot = await monitor.readHistory({
        maxPages: 1,
        maxResponseBytes: responseBudget,
      });
      expect(oversizedStreams.length).toBeGreaterThan(0);
      expect(oversizedStreams.every((metrics) => metrics.cancelled)).toBe(true);
      expect(oversizedStreams[0]?.bytesSent).toBeLessThan(oversizedStreams[0]?.totalBytes ?? 0);
      expect(oversizedStreams[0]?.bytesSent).toBeLessThanOrEqual(responseBudget + chunkBytes);
      expect(cursorSnapshotsBeforeRetry).toHaveLength(eventReads.length - 1);
      expect(cursorSnapshotsBeforeRetry.every((hasCursor) => hasCursor === false)).toBe(true);
      expect(eventReads.length).toBeGreaterThan(1);
      expect(eventReads.length).toBeLessThanOrEqual(8);
      expect(eventReads[0]?.limit).toBe(100);
      expect(eventReads[1]?.limit).toBeLessThan(100);
      expect(eventReads.every((request) =>
        request.before === eventReads[0]?.before && request.through === eventReads[0]?.through)).toBe(true);
      expect(oversizedStreams.length).toBe(eventReads.length - 1);
      const acceptedLimit = eventReads[eventReads.length - 1]!.limit;
      expect(snapshot.feeds.captures.records).toHaveLength(acceptedLimit);
      expect(snapshot.feeds.captures.records.map((item: any) => [item.event_id, item.text])).toEqual(
        largeCaptures.slice(0, acceptedLimit).map((item) => [item.event_id, item.text]),
      );
      expect(snapshot.feeds.captures.complete).toBe(false);
      expect(snapshot.cursor.after_local_seq).toBe(0);
    } finally {
      await monitor.stop();
    }

    const requestBudget = 1024 * 1024;
    const control = String.fromCharCode(1);
    const legalOriginals = Array.from({ length: 128 }, (_unused, index) => ({
      original_id: uuid('a0000000', index + 1),
      sha256: 'a'.repeat(64),
      byte_length: 0,
      file_name: '"'.repeat(1024),
      media_type: 'm'.repeat(256),
    }));
    const legalTags = Array.from({ length: 64 }, () => control.repeat(128));
    const makeLegalCommand = (textLength: number) => ({
      command_id: COMMAND_ID,
      event_id: EVENT_ID,
      profile_id: PROFILE_ID,
      occurred_at_ms: 1_800_000_000_000,
      text: control.repeat(textLength),
      tags: legalTags,
      originals: legalOriginals,
    });
    let low = 0;
    let high = 128 * 1024;
    let legalCommand = makeLegalCommand(0);
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = makeLegalCommand(middle);
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
      if (candidateBytes <= requestBudget - 1) {
        legalCommand = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const legalRequestBytes = Buffer.byteLength(JSON.stringify(legalCommand), 'utf8');
    expect(legalCommand.text.length).toBeLessThanOrEqual(128 * 1024);
    expect(legalRequestBytes).toBeGreaterThan(requestBudget - 1024);
    expect(legalRequestBytes).toBeLessThanOrEqual(requestBudget);
    const legalRecord = {
      event_id: legalCommand.event_id,
      profile_id: PROFILE_ID,
      device_id: DEVICE_ID,
      author_id: HUMAN_ID,
      author_kind: 'human',
      occurred_at_ms: legalCommand.occurred_at_ms,
      text: legalCommand.text,
      tags: legalCommand.tags,
      digest: digest('legal single capture'),
      local_seq: 1,
      originals: legalCommand.originals,
    };
    const legalPageBytes = Buffer.from(JSON.stringify({
      items: [legalRecord],
      next_before: null,
      highwater: 1,
    }), 'utf8');
    expect(legalPageBytes.byteLength).toBeGreaterThan(requestBudget);
    expect(legalPageBytes.byteLength).toBeLessThan(2 * requestBudget);

    const strictStore = memoryStateStore();
    const strictLimits: number[] = [];
    const strictStreams: Array<{ bytesSent: number; cancelled: boolean; totalBytes: number }> = [];
    const strictFetch = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/events')) {
        strictLimits.push(Number(url.searchParams.get('limit') ?? '100'));
        const metrics = { bytesSent: 0, cancelled: false, totalBytes: legalPageBytes.byteLength };
        strictStreams.push(metrics);
        return streamJson(legalPageBytes, metrics);
      }
      return controlFetch(1)(input, init);
    };
    const strictMonitor = module.createBetaMonitorAdapter({
      handoff: nativeHandoff(endpoint),
      target: target(endpoint),
      stateStore: strictStore,
      fetchImpl: strictFetch,
    });
    try {
      await strictMonitor.connect();
      await expect(strictMonitor.readHistory({
        maxPages: 1,
        maxResponseBytes: responseBudget,
      })).rejects.toMatchObject({ code: 'record_too_large' });
      expect(strictLimits[0]).toBe(100);
      expect(strictLimits[strictLimits.length - 1]).toBe(1);
      expect(strictLimits.length).toBeLessThanOrEqual(8);
      expect(strictStreams.every((metrics) => metrics.cancelled)).toBe(true);
      expect(strictStore.values.size).toBe(0);
    } finally {
      await strictMonitor.stop();
    }

    const defaultStore = memoryStateStore();
    const defaultFetch = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/events')) {
        return new Response(legalPageBytes, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return controlFetch(1)(input, init);
    };
    const defaultMonitor = module.createBetaMonitorAdapter({
      handoff: nativeHandoff(endpoint),
      target: target(endpoint),
      stateStore: defaultStore,
      fetchImpl: defaultFetch,
    });
    try {
      await defaultMonitor.connect();
      const legalSnapshot = await defaultMonitor.readHistory({ maxPages: 1 });
      expect(legalSnapshot.feeds.captures.records).toHaveLength(1);
      expect(legalSnapshot.feeds.captures.records[0]?.text).toBe(legalCommand.text);
      expect(legalSnapshot.feeds.captures.records[0]?.originals).toHaveLength(128);
      expect(legalSnapshot.feeds.captures.complete).toBe(true);
      expect(legalSnapshot.cursor.after_local_seq).toBe(1);
    } finally {
      await defaultMonitor.stop();
    }
  });

  it('accepts maxPages=10000 while limiting work to four pages per feed and resuming fixed through', async () => {
    const captures = Array.from({ length: 501 }, (_unused, index) => capture(501 - index));
    const corrections = Array.from({ length: 501 }, (_unused, index) => correction(501 - index));
    const nodes = Array.from({ length: 501 }, (_unused, index) =>
      timeblockNode(501 - index, { kind: 'synthetic' }));
    const endpoint = 'http://127.0.0.1:1/beta/v1';
    const responseJson = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    const feedItems: Record<string, any[]> = {
      '/events': captures,
      '/corrections': corrections,
      '/timeblocks/nodes': nodes,
    };
    const feedRequests: Array<{ path: string; before: string | null; through: string | null }> = [];
    const fetchImpl = (input: any, init: any = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/beta/v1/hello') {
        return responseJson({
          protocol: 'exomind-beta/1',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          running: true,
        });
      }
      if (method === 'POST' && url.pathname.endsWith('/access/check')) {
        return responseJson({
          protocol: 'exomind-beta/1',
          runtime_id: RUNTIME_ID,
          device_id: DEVICE_ID,
          profile_id: PROFILE_ID,
          grant_kind: 'observer',
          agent_id: null,
          allowed: READ_CAPABILITIES,
          max_original_chunk_bytes: 262144,
        });
      }
      if (method === 'GET') {
        const path = Object.keys(feedItems).find((suffix) => url.pathname.endsWith(suffix));
        if (path) {
          const beforeValue = url.searchParams.get('before');
          const before = beforeValue === null ? Number.MAX_SAFE_INTEGER : Number(beforeValue);
          const limit = Number(url.searchParams.get('limit') ?? '100');
          feedRequests.push({
            path,
            before: beforeValue,
            through: url.searchParams.get('through'),
          });
          const items = feedItems[path].filter((item) => sequenceOf(item) < before);
          const itemsInPage = items.slice(0, limit);
          const nextBefore = items.length > itemsInPage.length
            ? sequenceOf(itemsInPage[itemsInPage.length - 1])
            : null;
          return responseJson({ items: itemsInPage, next_before: nextBefore, highwater: 501 });
        }
        if (url.pathname.endsWith('/timeblocks/current')) {
          return responseJson(currentTimeblock('completed'));
        }
      }
      return responseJson({ error: { code: 'not_found' } }, 404);
    };
    const module = await import(adapterUrl.href);
    const monitor = module.createBetaMonitorAdapter({
      handoff: nativeHandoff(endpoint),
      target: target(endpoint),
      stateStore: memoryStateStore(),
      fetchImpl,
    });

    try {
      await monitor.connect();
      const first = await monitor.readHistory({ maxPages: 10000 });
      expect(first.feeds.captures.pages).toHaveLength(4);
      expect(first.feeds.corrections.pages).toHaveLength(4);
      expect(first.timeblocks.nodes.pages).toHaveLength(4);
      expect(first.feeds.captures.complete).toBe(false);
      expect(first.feeds.corrections.complete).toBe(false);
      expect(first.timeblocks.nodes.complete).toBe(false);
      expect(first.cursor.complete).toBe(false);
      expect(first.feeds.captures.next_before).toBe(102);
      expect(first.feeds.corrections.next_before).toBe(102);
      expect(first.timeblocks.nodes.next_before).toBe(102);

      const second = await monitor.readHistory({ maxPages: 10000 });
      expect(second.feeds.captures.pages).toHaveLength(2);
      expect(second.feeds.corrections.pages).toHaveLength(2);
      expect(second.timeblocks.nodes.pages).toHaveLength(2);
      expect(second.feeds.captures.complete).toBe(true);
      expect(second.feeds.corrections.complete).toBe(true);
      expect(second.timeblocks.nodes.complete).toBe(true);
      expect(second.cursor).toMatchObject({ complete: true, after_local_seq: 501 });

      expect([...first.feeds.captures.records, ...second.feeds.captures.records]
        .map((item: any) => [item.event_id, item.text])).toEqual(
          captures.map((item) => [item.event_id, item.text]),
        );
      expect([...first.feeds.corrections.records, ...second.feeds.corrections.records]
        .map((item: any) => item.record.event_id)).toEqual(
          corrections.map((item) => item.record.event_id),
        );
      expect([...first.timeblocks.nodes.records, ...second.timeblocks.nodes.records]
        .map((item: any) => item.event_id)).toEqual(
          nodes.map((item) => item.event_id),
        );

      for (const suffix of ['/events', '/corrections', '/timeblocks/nodes']) {
        const reads = feedRequests.filter((call) => call.path === suffix);
        expect(reads).toHaveLength(6);
        expect(reads.map((call) => call.before)).toEqual([
          null,
          '402',
          '302',
          '202',
          '102',
          '2',
        ]);
        const expectedThrough = suffix === '/events'
          ? [null, '501', '501', '501', '501', '501']
          : ['501', '501', '501', '501', '501', '501'];
        expect(reads.map((call) => call.through)).toEqual(expectedThrough);
      }
    } finally {
      await monitor.stop();
    }
  });

  it('reads typed summary and agent-summary feeds across four pages under one highwater and resumes after restart', async () => {
    const originalFacts = Array.from({ length: 501 }, (_, index) => {
      const sequence = 501 - index;
      const kind: 'summary/1' | 'agent_summary/1' = sequence % 2 === 0 ? 'summary/1' : 'agent_summary/1';
      return typedSummaryItem(sequence, kind);
    });
    const lateFact = typedSummaryItem(502, 'agent_summary/1');
    let highwater = 501;
    let timelineFacts = [...originalFacts];
    const timelineReads: Array<{ before: string | null; through: string | null }> = [];
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response, { grantKind: 'agent_note', agentId: AGENT_ID })) return;
      const profilePath = '/beta/v1/profiles/' + PROFILE_ID;
      if (call.method === 'GET' && call.url.pathname === profilePath + '/events') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/corrections') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/nodes') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeline') {
        timelineReads.push({
          before: call.url.searchParams.get('before'),
          through: call.url.searchParams.get('through'),
        });
        pageAtFixedSnapshot(call, response, timelineFacts, highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/current') {
        json(response, currentTimeblock('completed'));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const module = await import(adapterUrl.href);
    const create = module.createBetaMonitorAdapter;
    const directory = mkdtempSync(join(tmpdir(), 'exomind-beta-monitor-boundary-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'monitor-state.json');
    const firstStore = module.createFileStateStore(statePath);
    const firstMonitor = create({
      handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
      target: target(host.apiBaseUrl),
      stateStore: firstStore,
    });

    try {
      await firstMonitor.connect();
      const first = await firstMonitor.readHistory({ maxPages: 10000, includeSummaryFeeds: true });
      expect(first.cursor.complete).toBe(true);
      expect(first.coverage.full_history_complete).toBe(false);
      expect(first.feeds.summaries.pages).toHaveLength(4);
      expect(first.feeds.agentSummaries.pages).toHaveLength(4);
      expect(first.feeds.summaries).toMatchObject({
        available: true,
        through: 501,
        before: null,
        next_before: 102,
        complete: false,
      });
      expect(first.feeds.agentSummaries).toMatchObject({
        available: true,
        through: 501,
        before: null,
        next_before: 102,
        complete: false,
      });
      expect(first.feeds.summaries.records).toEqual(
        originalFacts.slice(0, 400).filter((item) => item.kind === 'summary/1'),
      );
      expect(first.feeds.agentSummaries.records).toEqual(
        originalFacts.slice(0, 400).filter((item) => item.kind === 'agent_summary/1'),
      );
      expect(first.feeds.summaries.pages[0]?.items).toEqual(originalFacts.slice(0, 100));
      expect(first.feeds.agentSummaries.records[0]?.record.producer_agent_id).toBe(AGENT_ID);
      expect(first.feeds.agentSummaries.records[0]?.record).not.toHaveProperty('author_kind');
      expect(first.feeds.agentSummaries.records[0]?.record).not.toHaveProperty('trusted_local');
      expect(first.feeds.summaries.records[0]?.record.author_id).toBe(DEVICE_ID);
      expect(first.feeds.summaries.records[0]?.record).not.toHaveProperty('author_kind');

      timelineFacts = [lateFact, ...timelineFacts];
      highwater = 502;
      await firstMonitor.stop();

      const resumedStore = module.createFileStateStore(statePath);
      const resumedMonitor = create({
        handoff: nativeHandoff(host.apiBaseUrl, { kind: 'agent_note', agentId: AGENT_ID }),
        target: target(host.apiBaseUrl),
        stateStore: resumedStore,
      });
      try {
        await resumedMonitor.connect();
        const second = await resumedMonitor.readHistory({ maxPages: 1, includeSummaryFeeds: true });
        const third = await resumedMonitor.readHistory({ maxPages: 1, includeSummaryFeeds: true });
        expect(second.through).toBe(501);
        expect(third.through).toBe(501);
        expect(second.feeds.summaries).toMatchObject({ before: 102, next_before: 2, complete: false });
        expect(third.feeds.summaries).toMatchObject({ before: 2, next_before: null, complete: true });
        expect(second.feeds.agentSummaries.complete).toBe(false);
        expect(third.feeds.agentSummaries.complete).toBe(true);
        expect(third.coverage.full_history_complete).toBe(true);
        expect(timelineReads.slice(0, 6)).toEqual([
          { before: null, through: '501' },
          { before: '402', through: '501' },
          { before: '302', through: '501' },
          { before: '202', through: '501' },
          { before: '102', through: '501' },
          { before: '2', through: '501' },
        ]);

        const allSummaryFacts = [
          ...first.feeds.summaries.records,
          ...second.feeds.summaries.records,
          ...third.feeds.summaries.records,
        ];
        const allAgentSummaryFacts = [
          ...first.feeds.agentSummaries.records,
          ...second.feeds.agentSummaries.records,
          ...third.feeds.agentSummaries.records,
        ];
        expect(allSummaryFacts).toEqual(originalFacts.filter((item) => item.kind === 'summary/1'));
        expect(allAgentSummaryFacts).toEqual(originalFacts.filter((item) => item.kind === 'agent_summary/1'));
        expect(allSummaryFacts.length + allAgentSummaryFacts.length).toBe(501);

        const fresh = await resumedMonitor.readHistory({
          maxPages: 1,
          includeSummaryFeeds: true,
          fresh: true,
        });
        expect(fresh.through).toBe(502);
        expect(fresh.feeds.agentSummaries.records).toContainEqual(lateFact);
        expect(timelineReads[6]).toEqual({ before: null, through: '502' });
        expect(host.calls.some((call) => call.method === 'POST' && !call.url.pathname.endsWith('/access/check'))).toBe(
          false,
        );
      } finally {
        await resumedMonitor.stop();
      }
    } finally {
      await firstMonitor.stop();
    }
  });

  it('reports missing timeline_read as an explicit partial summary scope without fallback', async () => {
    const highwater = 20;
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response, { allowed: READ_CAPABILITIES })) return;
      const profilePath = '/beta/v1/profiles/' + PROFILE_ID;
      if (call.method === 'GET' && call.url.pathname === profilePath + '/events') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/corrections') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/nodes') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/current') {
        json(response, currentTimeblock('completed'));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      await monitor.connect();
      const snapshot = await monitor.readHistory({ includeSummaryFeeds: true });
      expect(snapshot.cursor.complete).toBe(true);
      expect(snapshot.coverage.full_history_complete).toBe(false);
      expect(snapshot.feeds.summaries).toMatchObject({
        available: false,
        complete: false,
        missing_capability: 'timeline_read',
      });
      expect(snapshot.feeds.agentSummaries).toMatchObject({
        available: false,
        complete: false,
        missing_capability: 'timeline_read',
      });
      expect(host.calls.some((call) => call.method === 'GET' && call.url.pathname.endsWith('/timeline'))).toBe(false);
      expect(host.calls.some((call) => call.url.pathname.includes('/export-bundle'))).toBe(false);
      expect(host.calls.some((call) => /\/(?:health|version|act\/|eventlog)(?:\/|$)/.test(call.url.pathname))).toBe(
        false,
      );
    } finally {
      await monitor.stop();
    }
  });

  it('rejects a summary fact that conflicts with an already-read capture digest', async () => {
    const highwater = 20;
    const existingCapture = capture(12);
    const conflictingSummary = typedSummaryItem(8, 'summary/1', {
      event_id: existingCapture.event_id,
      digest: digest('conflicting-summary-body'),
    });
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      const profilePath = '/beta/v1/profiles/' + PROFILE_ID;
      if (call.method === 'GET' && call.url.pathname === profilePath + '/events') {
        pageAtFixedSnapshot(call, response, [existingCapture], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/corrections') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/nodes') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeline') {
        pageAtFixedSnapshot(call, response, [conflictingSummary], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/current') {
        json(response, currentTimeblock('completed'));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      await monitor.connect();
      await expect(monitor.readHistory({ includeSummaryFeeds: true })).rejects.toMatchObject({
        code: 'fact_digest_conflict',
      });
      expect(host.calls.some((call) => call.method === 'POST' && !call.url.pathname.endsWith('/access/check'))).toBe(
        false,
      );
    } finally {
      await monitor.stop();
    }
  });

  it('does not restart completed legacy feeds while opt-in timeline pages continue at the same through', async () => {
    const captures = Array.from({ length: 106 }, (_, index) => capture(106 - index));
    const timelineFacts = Array.from({ length: 201 }, (_, index) => {
      const sequence = 307 - index;
      const kind: 'summary/1' | 'agent_summary/1' = sequence % 2 === 0 ? 'summary/1' : 'agent_summary/1';
      return typedSummaryItem(sequence, kind);
    });
    const highwater = 307;
    const timelineReads: Array<{ before: string | null; through: string | null }> = [];
    const host = await startHost((call, response) => {
      if (replyIdentity(call, response)) return;
      const profilePath = '/beta/v1/profiles/' + PROFILE_ID;
      if (call.method === 'GET' && call.url.pathname === profilePath + '/events') {
        pageAtFixedSnapshot(call, response, captures, highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/corrections') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/nodes') {
        pageAtFixedSnapshot(call, response, [], highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeline') {
        timelineReads.push({
          before: call.url.searchParams.get('before'),
          through: call.url.searchParams.get('through'),
        });
        pageAtFixedSnapshot(call, response, timelineFacts, highwater);
        return;
      }
      if (call.method === 'GET' && call.url.pathname === profilePath + '/timeblocks/current') {
        json(response, currentTimeblock('completed'));
        return;
      }
      json(response, { error: { code: 'not_found' } }, 404);
    });
    const create = await loadFactory();
    const monitor = create({
      handoff: nativeHandoff(host.apiBaseUrl),
      target: target(host.apiBaseUrl),
      stateStore: memoryStateStore(),
    });

    try {
      await monitor.connect();
      const legacy = await monitor.readHistory({ maxPages: 1 });
      expect(legacy.cursor.complete).toBe(false);
      expect(legacy.feeds.captures.complete).toBe(false);
      expect(legacy.feeds.captures.records.map(sequenceOf)).toEqual(captures.slice(0, 100).map(sequenceOf));
      expect(legacy).not.toHaveProperty('coverage');
      expect(legacy.feeds).not.toHaveProperty('summaries');

      const firstOptIn = await monitor.readHistory({ maxPages: 1, includeSummaryFeeds: true });
      expect(firstOptIn.through).toBe(highwater);
      expect(firstOptIn.cursor.complete).toBe(true);
      expect(firstOptIn.feeds.captures.complete).toBe(true);
      expect(firstOptIn.feeds.captures.records.map(sequenceOf)).toEqual(captures.slice(100).map(sequenceOf));
      expect(firstOptIn.feeds.corrections.complete).toBe(true);
      expect(firstOptIn.timeblocks.nodes.complete).toBe(true);
      expect(firstOptIn.feeds.summaries).toMatchObject({ through: highwater, next_before: 208, complete: false });
      expect(firstOptIn.coverage.full_history_complete).toBe(false);

      const secondOptIn = await monitor.readHistory({ maxPages: 1, includeSummaryFeeds: true });
      expect(secondOptIn.through).toBe(highwater);
      expect(secondOptIn.feeds.captures.pages).toEqual([]);
      expect(secondOptIn.feeds.captures.records).toEqual([]);
      expect(secondOptIn.feeds.captures.complete).toBe(true);
      expect(secondOptIn.feeds.corrections.pages).toEqual([]);
      expect(secondOptIn.timeblocks.nodes.pages).toEqual([]);
      expect(secondOptIn.feeds.summaries).toMatchObject({ before: 208, next_before: 108, complete: false });
      expect(secondOptIn.coverage.full_history_complete).toBe(false);

      const thirdOptIn = await monitor.readHistory({ maxPages: 1, includeSummaryFeeds: true });
      expect(thirdOptIn.feeds.captures.pages).toEqual([]);
      expect(thirdOptIn.feeds.captures.complete).toBe(true);
      expect(thirdOptIn.feeds.summaries).toMatchObject({ before: 108, next_before: null, complete: true });
      expect(thirdOptIn.feeds.agentSummaries.complete).toBe(true);
      expect(thirdOptIn.coverage.full_history_complete).toBe(true);

      const eventReads = host.calls.filter(
        (call) => call.method === 'GET' && call.url.pathname === '/beta/v1/profiles/' + PROFILE_ID + '/events',
      );
      expect(eventReads.map((call) => call.url.searchParams.get('before'))).toEqual([null, '7']);
      expect(eventReads.map((call) => call.url.searchParams.get('through'))).toEqual([null, String(highwater)]);
      expect(timelineReads).toEqual([
        { before: null, through: String(highwater) },
        { before: '208', through: String(highwater) },
        { before: '108', through: String(highwater) },
      ]);
      expect(host.calls.some((call) => call.method === 'POST' && !call.url.pathname.endsWith('/access/check'))).toBe(
        false,
      );
    } finally {
      await monitor.stop();
    }
  });

  it('bounds CLI stdin bytes and rejects malformed UTF-8 before parsing a handoff', () => {
    const endpoint = 'http://127.0.0.1:1/beta/v1';
    const envelope = {
      operation: 'preflight',
      handoff: nativeHandoff(endpoint),
      target: target(endpoint),
    };
    const oversized = JSON.stringify({
      ...envelope,
      padding: 'x'.repeat(256 * 1024),
    });
    const oversizedRun = spawnSync(process.execPath, [adapterPath, 'preflight'], {
      cwd: tmpdir(),
      input: Buffer.from(oversized, 'utf8'),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 64 * 1024,
    });
    expect(oversizedRun.error).toBeUndefined();
    expect(oversizedRun.status).toBe(1);
    expect(oversizedRun.stderr).toContain('stdin_limit_exceeded');
    expect(oversizedRun.stderr).not.toContain('x'.repeat(128));

    const validBytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    const marker = Buffer.from('Synthetic monitor fixture', 'utf8');
    const markerOffset = validBytes.indexOf(marker);
    expect(markerOffset).toBeGreaterThanOrEqual(0);
    const malformedBytes = Buffer.concat([
      validBytes.subarray(0, markerOffset),
      Buffer.from([0xff]),
      validBytes.subarray(markerOffset + 1),
    ]);
    const malformedRun = spawnSync(process.execPath, [adapterPath, 'preflight'], {
      cwd: tmpdir(),
      input: malformedBytes,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 64 * 1024,
    });
    expect(malformedRun.error).toBeUndefined();
    expect(malformedRun.status).toBe(1);
    expect(malformedRun.stdout).toBe('');
    expect(malformedRun.stderr).toContain('invalid_utf8');
  });

  it('does not scan a working-directory owner descriptor when the handoff is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'exomind-beta-monitor-no-handoff-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'connection.beta.json'), JSON.stringify({
      protocol: 'exomind-beta/1',
      url: 'http://127.0.0.1:1',
      owner_token: TOKEN,
    }));

    const input = JSON.stringify({
      operation: 'preflight',
      target: {
        apiBaseUrl: 'http://127.0.0.1:1/beta/v1',
        runtimeId: RUNTIME_ID,
        profileId: PROFILE_ID,
      },
    });
    const result = spawnSync(process.execPath, [adapterPath, 'preflight'], {
      cwd: directory,
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 256 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/native_handoff_required/);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
