import { sha256 } from '@noble/hashes/sha2.js';
import { BetaApiError, type BetaClient, type BetaCommand, type BetaEvent, type BetaProfile, type BetaQuery, type BetaReceipt } from './client';
import type { FileSourceStore } from './file-source-store';
import type { LocalIntentJournal } from './local-intent-journal';
import type { BetaBeginStage, BetaOriginal, BetaOriginalClient, BetaStage } from './original-types';
import type { BetaPeersClient } from './peers-client';
import type { BetaDeadlineHandoffsClient } from './deadline-handoff-client';
import type { BetaShareHandoffsClient } from './share-handoff-client';
import type {
  BetaActiveBlock,
  BetaInterval,
  BetaIntervalPage,
  BetaIntervalQuery,
  BetaTimeblockClient,
  BetaTimeblockCommand,
  BetaTimeblockNode,
  BetaTimeblockSnapshot,
  BetaTimelineItem,
  BetaTimelinePage,
  BetaTimelinePeriodQuery,
} from './timeblocks-types';

const MOCK_PROFILE_NAME = '前端测试档案（内存）';
const PAGE_SIZE_MAX = 100;

export interface BetaMockProfile {
  readonly instanceId: string;
  readonly client: BetaClient;
  readonly deviceId: string;
  readonly profileId: string;
  readonly runtimeId: string;
  readonly intentJournal: LocalIntentJournal;
  readonly sourceStore: FileSourceStore;
  readonly peers?: BetaPeersClient | null;
  readonly handoffs?: BetaDeadlineHandoffsClient | null;
  readonly shareHandoffs?: BetaShareHandoffsClient | null;
}

export interface BetaMockProfileOptions {
  idFactory?: () => string;
  now?: () => number;
  seedTexts?: readonly string[];
  clientOverrides?: Partial<BetaClient>;
  peers?: BetaPeersClient | null;
  handoffs?: BetaDeadlineHandoffsClient | null;
  shareHandoffs?: BetaShareHandoffsClient | null;
}

interface MockStage {
  begin: BetaBeginStage;
  stage: BetaStage;
  bytes: Uint8Array;
}

interface MockTimeblockState {
  epochId: string;
  epochStart: number;
  revision: number;
  nodes: BetaTimeblockNode[];
  heads: string[];
  active: BetaActiveBlock | null;
  pendingFeedback: Set<string>;
}

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const tail = Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12);
  return `00000000-0000-4000-8000-${tail}`;
}

function digestHex(value: unknown): string {
  const bytes = sha256(new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function digestBytes(value: Uint8Array): string {
  return Array.from(sha256(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pageBounds<T extends { local_seq: number }>(items: readonly T[], query: BetaQuery, highwater: number) {
  const through = query.through ?? highwater;
  const before = query.before ?? Number.MAX_SAFE_INTEGER;
  const limit = Math.max(1, Math.min(PAGE_SIZE_MAX, query.limit ?? 50));
  const eligible = items
    .filter(item => item.local_seq <= through && item.local_seq < before)
    .sort((left, right) => right.local_seq - left.local_seq);
  const selected = eligible.slice(0, limit);
  return {
    items: selected,
    highwater: through,
    next_before: eligible.length > selected.length ? selected[selected.length - 1]?.local_seq ?? null : null,
  };
}

function createMemoryJournal(): LocalIntentJournal {
  const values = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => listeners.get(key)?.forEach(listener => listener());
  return {
    async read(key) { return values.get(key) ?? null; },
    async write(key, raw) { values.set(key, raw); notify(key); },
    async compareWrite(key, expectedRaw, raw) {
      if ((values.get(key) ?? null) !== expectedRaw) throw new Error('mock journal compare failed');
      values.set(key, raw);
      notify(key);
    },
    subscribe(key, changed) {
      const bucket = listeners.get(key) ?? new Set<() => void>();
      bucket.add(changed);
      listeners.set(key, bucket);
      return () => { bucket.delete(changed); if (!bucket.size) listeners.delete(key); };
    },
    close() { values.clear(); listeners.clear(); },
  };
}

function createMemorySourceStore(): FileSourceStore {
  const sources = new Map<string, Blob>();
  let closed = false;
  return {
    async put(key, source) {
      if (closed) throw new Error('mock source store is closed');
      sources.set(key, source.slice());
    },
    async get(key) {
      if (closed) throw new Error('mock source store is closed');
      return sources.get(key) ?? null;
    },
    async remove(key) { sources.delete(key); },
    close() { closed = true; sources.clear(); },
  };
}

function createMemoryOriginalsClient(profileExists: (id: string) => boolean): BetaOriginalClient {
  const stages = new Map<string, MockStage>();
  const originals = new Map<string, { profileId: string; descriptor: BetaOriginal; bytes: Uint8Array }>();

  function requireProfile(profileId: string): void {
    if (!profileExists(profileId)) throw new BetaApiError('profile_not_found', '测试档案不存在');
  }
  function requireStage(profileId: string, stageId: string): MockStage {
    requireProfile(profileId);
    const item = stages.get(stageId);
    if (!item || item.begin.profile_id !== profileId) throw new BetaApiError('stage_not_found', '测试附件暂存不存在');
    return item;
  }
  function descriptor(begin: BetaBeginStage): BetaOriginal {
    return { original_id: begin.original_id, sha256: begin.expected_sha256, byte_length: begin.byte_length,
      file_name: begin.file_name, media_type: begin.media_type };
  }

  return {
    async begin(begin) {
      requireProfile(begin.profile_id);
      const current = stages.get(begin.stage_id);
      if (current) return clone(current.stage);
      const item: MockStage = {
        begin: clone(begin),
        stage: { stage_id: begin.stage_id, profile_id: begin.profile_id, original: descriptor(begin), state: 'uploading', next_offset: 0, generation: 1 },
        bytes: new Uint8Array(),
      };
      stages.set(begin.stage_id, item);
      return clone(item.stage);
    },
    async status(profileId, stageId) { return clone(requireStage(profileId, stageId).stage); },
    async write(profileId, stageId, offset, bytes) {
      const item = requireStage(profileId, stageId);
      if (offset < item.bytes.length) {
        const replay = item.bytes.slice(offset, offset + bytes.length);
        if (replay.length === bytes.length && replay.every((byte, index) => byte === bytes[index])) return clone(item.stage);
        throw new BetaApiError('mock_stage_conflict', '测试附件收到不一致的重复分块');
      }
      if (offset !== item.bytes.length || offset + bytes.length > item.begin.byte_length) {
        throw new BetaApiError('mock_stage_offset', '测试附件分块位置无效');
      }
      const next = new Uint8Array(item.bytes.length + bytes.length);
      next.set(item.bytes);
      next.set(bytes, item.bytes.length);
      item.bytes = next;
      item.stage = { ...item.stage, next_offset: next.length };
      return clone(item.stage);
    },
    async verify(profileId, stageId) {
      const item = requireStage(profileId, stageId);
      const actual = digestBytes(item.bytes);
      const expectedLength = item.begin.byte_length;
      const valid = item.bytes.length === expectedLength && actual === item.begin.expected_sha256;
      item.stage = { ...item.stage, state: valid ? 'verified' : 'hash_mismatch', next_offset: item.bytes.length };
      if (valid) originals.set(item.begin.original_id, { profileId, descriptor: descriptor(item.begin), bytes: item.bytes.slice() });
      return clone(item.stage);
    },
    async readStage(profileId, stageId, offset, length) {
      const bytes = requireStage(profileId, stageId).bytes;
      return bytes.slice(offset, offset + length);
    },
    async readOriginal(profileId, originalId, offset, length) {
      requireProfile(profileId);
      const original = originals.get(originalId);
      if (!original || original.profileId !== profileId) throw new BetaApiError('original_not_found', '测试原件不存在');
      return original.bytes.slice(offset, offset + length);
    },
  };
}

export function createBetaMockProfile(options: BetaMockProfileOptions = {}): BetaMockProfile {
  const id = options.idFactory ?? createUuid;
  const now = options.now ?? Date.now;
  const profileId = id();
  const deviceId = id();
  const runtimeId = id();
  const profile: BetaProfile = { profile_id: profileId, display_name: MOCK_PROFILE_NAME };
  const profiles = new Map<string, BetaProfile>([[profileId, profile]]);
  const events = new Map<string, BetaEvent[]>([[profileId, []]]);
  const timeblocksByProfile = new Map<string, MockTimeblockState>();
  const receipts = new Map<string, BetaReceipt>();
  const timeblockReceipts = new Map<string, BetaReceipt>();
  let nextLocalSeq = 1;
  const newTimeblockState = (): MockTimeblockState => ({ epochId: id(), epochStart: now(), revision: 0, nodes: [], heads: [], active: null, pendingFeedback: new Set() });
  timeblocksByProfile.set(profileId, newTimeblockState());

  const createReceipt = (command: Pick<BetaCommand, 'command_id' | 'event_id' | 'profile_id'>, localSeq: number, eventDigest: string, replayed = false): BetaReceipt => ({
    command_id: command.command_id, event_id: command.event_id, profile_id: command.profile_id,
    local_seq: localSeq, event_digest: eventDigest, durability: 'local_committed', replayed,
  });
  const latestSeq = () => nextLocalSeq - 1;
  const profileFor = (idToFind: string) => {
    if (!profiles.has(idToFind)) throw new BetaApiError('profile_not_found', '测试档案不存在');
  };
  const timeblockState = (idToFind: string) => {
    profileFor(idToFind);
    const state = timeblocksByProfile.get(idToFind);
    if (!state) throw new BetaApiError('profile_not_found', '测试档案不存在');
    return state;
  };
  const eventList = (idToFind: string) => {
    profileFor(idToFind);
    return events.get(idToFind)!;
  };

  for (const [index, text] of (options.seedTexts ?? [
    '这是只存在于当前页面内存的测试档案。刷新或重置后会重新生成。',
    '焦点专项：发送一条合成消息后，输入框应留在发送框中。',
    '你可以在这里测试时间块、标签和附件暂存，不会访问真实档案。',
  ]).entries()) {
    const eventId = id();
    const occurredAt = now() - ((options.seedTexts?.length ?? 3) - index) * 60_000;
    const record: BetaEvent = {
      event_id: eventId, profile_id: profileId, device_id: deviceId, author_id: deviceId, author_kind: 'human',
      occurred_at_ms: occurredAt, text, tags: index === 1 ? ['mock', '焦点测试'] : ['mock'],
      digest: digestHex({ eventId, text }), local_seq: nextLocalSeq++,
    };
    eventList(profileId).push(record);
  }

  const timeblocks: BetaTimeblockClient = {
    async snapshot(requestedProfileId): Promise<BetaTimeblockSnapshot> {
      const state = timeblockState(requestedProfileId);
      return {
        profile_id: requestedProfileId,
        revision: digestHex({ revision: state.revision, heads: state.heads, active: state.active, pendingFeedback: [...state.pendingFeedback].sort() }),
        heads: [...state.heads], active: state.active ? clone(state.active) : null,
        pending_feedback: [...state.pendingFeedback],
        clock: { server_now_ms: now(), epoch_changed: false, wall_clock_moved_back: false },
      };
    },
    async command(command: BetaTimeblockCommand): Promise<BetaReceipt> {
      const state = timeblockState(command.profile_id);
      const existing = timeblockReceipts.get(command.command_id);
      if (existing) return { ...existing, replayed: true };
      const currentRevision = digestHex({ revision: state.revision, heads: state.heads, active: state.active, pendingFeedback: [...state.pendingFeedback].sort() });
      if (command.expected_revision !== currentRevision) throw new BetaApiError('revision_conflict', '测试时间块已变化，请刷新后重试');
      const action = clone(command.action);
      if (action.kind === 'start') {
        state.active = { block_id: action.block_id, name: action.name, note: action.note, timer: action.timer, phase: 'running', work_ms: 0, deadline_reached: false, deadline: null };
      } else if (action.kind === 'rotate') {
        state.active = { ...action.next, phase: 'running', work_ms: 0, deadline_reached: false, deadline: null };
      } else if (action.kind === 'pause' && state.active?.block_id === action.block_id) {
        state.active = { ...state.active, phase: 'paused' };
      } else if (action.kind === 'resume' && state.active?.block_id === action.block_id) {
        state.active = { ...state.active, phase: 'running' };
      } else if (action.kind === 'end_action' && state.active?.block_id === action.block_id) {
        state.active = { ...state.active, phase: 'feedback_pending' };
        state.pendingFeedback.add(action.block_id);
      } else if (action.kind === 'submit_feedback') {
        state.pendingFeedback.delete(action.block_id);
        if (state.active?.block_id === action.block_id) state.active = null;
      }
      const occurredAt = now();
      const node: BetaTimeblockNode = {
        event_id: command.event_id, profile_id: profileId, device_id: deviceId,
        source: { kind: 'human', author_id: deviceId, owner_generation: null }, parents: [...state.heads],
        occurred_at_ms: occurredAt, effective_at_ms: occurredAt,
        clock: { epoch_id: state.epochId, elapsed_ms: Math.max(0, occurredAt - state.epochStart) },
        payload: { kind: 'action', action }, digest: digestHex({ command, occurredAt }), local_seq: nextLocalSeq++,
      };
      state.nodes.push(node);
      state.heads = [node.event_id];
      state.revision++;
      const receipt = createReceipt(command, node.local_seq, node.digest);
      timeblockReceipts.set(command.command_id, receipt);
      return clone(receipt);
    },
    async nodes(requestedProfileId, query) {
      const state = timeblockState(requestedProfileId);
      return pageBounds(state.nodes, query, latestSeq());
    },
    async intervals(requestedProfileId, query: BetaIntervalQuery): Promise<BetaIntervalPage> {
      const state = timeblockState(requestedProfileId);
      const currentRevision = digestHex({ revision: state.revision, heads: state.heads, active: state.active, pendingFeedback: [...state.pendingFeedback].sort() });
      if (query.through && query.through !== currentRevision) throw new BetaApiError('revision_conflict', '测试时间块快照已变化');
      const from = query.from_ms;
      const to = query.to_ms;
      if (to <= from) return { items: [], revision: currentRevision, next_from_ms: null, complete: true };
      const observedTo = Math.min(to, Math.max(from, now()));
      const items: BetaInterval[] = [];
      if (state.active && observedTo > from) items.push({ from_ms: from, to_ms: observedTo,
        kind: state.active.phase === 'paused' ? 'paused' : 'running', block_id: state.active.block_id, source_event_ids: [...state.heads] });
      if (observedTo < to) items.push({ from_ms: observedTo, to_ms: to, kind: 'gap', block_id: null, source_event_ids: [] });
      if (!items.length) items.push({ from_ms: from, to_ms: to, kind: 'gap', block_id: null, source_event_ids: [] });
      return { items, revision: currentRevision, next_from_ms: null, complete: true };
    },
  };

  const timelineItems = (requestedProfileId: string): BetaTimelineItem[] => {
    profileFor(requestedProfileId);
    return [
      ...eventList(requestedProfileId).map(record => ({ kind: 'capture' as const, record })),
      ...timeblockState(requestedProfileId).nodes.map(record => ({ kind: 'timeblock' as const, record })),
    ];
  };
  const filterTimeline = (items: BetaTimelineItem[], query: BetaQuery, highwater: number) => pageBounds(items.map(item => ({...item, local_seq:item.record.local_seq})), query, highwater);
  const pageTimeline = (requestedProfileId: string, query: BetaQuery): BetaTimelinePage => {
    const page = filterTimeline(timelineItems(requestedProfileId), query, latestSeq());
    return { ...page, items: page.items.map(({local_seq: _localSeq, ...item}) => item) };
  };

  const originals: BetaOriginalClient = createMemoryOriginalsClient(idToFind => profiles.has(idToFind));
  const client: BetaClient = {
    serviceScope: `dev-mock-profile:${runtimeId}`,
    originals,
    timeblocks,
    timelinePage: async (requestedProfileId, query) => pageTimeline(requestedProfileId, query),
    timelinePeriodPage: async (requestedProfileId, query: BetaTimelinePeriodQuery) => {
      const items = timelineItems(requestedProfileId).filter(item => item.record.occurred_at_ms >= query.from_ms && item.record.occurred_at_ms < query.to_ms
        && (!query.tag || (item.kind === 'capture' && item.record.tags.includes(query.tag))));
      const page = filterTimeline(items, query, latestSeq());
      return { ...page, items: page.items.map(({local_seq: _localSeq, ...item}) => item) };
    },
    timelineEvent: async (requestedProfileId, eventId) => timelineItems(requestedProfileId).find(item => item.record.event_id === eventId) ?? null,
    async status() {
      return { protocol: 'exomind-beta/1', device_id: deviceId, runtime_id: runtimeId, running: true,
        capabilities: { originals: true, max_original_chunk_bytes: 256 * 1024, timeblocks: true, typed_timeline: true, timeline_period: true } };
    },
    async profiles() { return Array.from(profiles.values(), profile => ({ ...profile })); },
    async provisionProfile(nextProfileId, displayName) {
      const next = { profile_id: nextProfileId, display_name: displayName };
      profiles.set(nextProfileId, next);
      events.set(nextProfileId, []);
      timeblocksByProfile.set(nextProfileId, newTimeblockState());
      return { ...next };
    },
    async capture(command) {
      profileFor(command.profile_id);
      const existing = receipts.get(command.command_id);
      if (existing) return { ...existing, replayed: true };
      const eventDigest = digestHex(command);
      const record: BetaEvent = {
        event_id: command.event_id, profile_id: command.profile_id, device_id: deviceId, author_id: deviceId,
        author_kind: 'human', occurred_at_ms: command.occurred_at_ms, text: command.text, tags: [...command.tags],
        digest: eventDigest, local_seq: nextLocalSeq++, ...(command.originals ? { originals: clone(command.originals) } : {}),
      };
      eventList(command.profile_id).push(record);
      const receipt = createReceipt(command, record.local_seq, eventDigest);
      receipts.set(command.command_id, receipt);
      return clone(receipt);
    },
    async eventsPage(requestedProfileId, query) {
      const page = pageBounds(eventList(requestedProfileId), query, latestSeq());
      return { ...page, items: page.items.map(clone) };
    },
    async receipt(requestedProfileId, commandId) {
      profileFor(requestedProfileId);
      const receipt = receipts.get(commandId) ?? timeblockReceipts.get(commandId);
      return receipt?.profile_id === requestedProfileId ? clone(receipt) : null;
    },
  };

  const intentJournal = createMemoryJournal();
  const sourceStore = createMemorySourceStore();
  const instanceId = id();
  return {
    client: { ...client, ...options.clientOverrides },
    deviceId, profileId, runtimeId, intentJournal, sourceStore, instanceId,
    peers: options.peers, handoffs: options.handoffs, shareHandoffs: options.shareHandoffs,
  };
}
