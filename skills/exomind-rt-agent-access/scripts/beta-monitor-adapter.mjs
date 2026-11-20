import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const PROTOCOL = 'exomind-beta/1';
const PAGE_LIMIT = 100;
const MAX_ORIGINAL_CHUNK_BYTES = 262144;
const MAX_ORIGINAL_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_CLI_STDIN_BYTES = 256 * 1024;
const MAX_FILE_STATE_BYTES = 512 * 1024;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_READ_HISTORY_PAGES_PER_FEED = 4;
const MAX_SEEN_FACTS = 1024;
const READ_CAPABILITIES = Object.freeze(['events_read', 'timeblocks_read', 'originals_read', 'wait']);
const SUMMARY_HISTORY_CAPABILITY = 'timeline_read';
const SUMMARY_HISTORY_KINDS = Object.freeze({
  summaries: 'summary/1',
  agentSummaries: 'agent_summary/1',
});
const PUBLIC_HISTORY_TYPED_KINDS = Object.freeze([
  'capture/1',
  'capture/2',
  'correction/1',
  'timeblock/1',
  'summary/1',
  'agent_summary/1',
]);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export class BetaMonitorError extends Error {
  constructor(code, message = code, status = undefined) {
    super(message);
    this.name = 'BetaMonitorError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function fail(code, message = code) { throw new BetaMonitorError(code, message); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, expected, code) {
  if (!isRecord(value)) fail(code, 'Invalid Beta handoff.');
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code, 'Invalid Beta handoff.');
}
function requireString(value, code, message) {
  if (typeof value !== 'string' || value.length === 0) fail(code, message);
  return value;
}
function requireUuid(value, code, message) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(code, message);
  return value.toLowerCase();
}
function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  if (!host.startsWith('127.')) return false;
  const parts = host.split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255);
}
function parseEndpoint(value) {
  let url;
  try { url = new URL(requireString(value, 'invalid_endpoint', 'Invalid Beta endpoint.')); }
  catch (error) {
    if (error instanceof BetaMonitorError) throw error;
    fail('invalid_endpoint', 'Invalid Beta endpoint.');
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url['pass' + 'word'] || url.search || url.hash
    || !isLoopbackHost(url.hostname)
    || url.pathname.replace(/\/+$/, '') !== '/beta/v1') {
    fail('invalid_endpoint', 'Beta endpoint must be an explicit loopback /beta/v1 URL.');
  }
  return { origin: url.origin, prefix: '/beta/v1', normalized: `${url.origin}/beta/v1` };
}
function parseHandoff(value) {
  exactKeys(value, ['protocol', 'api_base_url', 'api', 'device', 'profile', 'grant', 'credential', 'network'], 'invalid_handoff');
  if (value.protocol !== PROTOCOL) fail('invalid_handoff', 'Invalid Beta Native handoff.');
  const endpoint = parseEndpoint(value.api_base_url);
  exactKeys(value.api, ['hello', 'access_check', 'authorization_header'], 'invalid_handoff');
  if (value.api.hello !== 'GET /hello'
    || value.api.access_check !== 'POST /profiles/{profile_id}/access/check'
    || value.api.authorization_header !== 'Authorization: Bearer <credential.token>') fail('invalid_handoff', 'Invalid Beta Native handoff.');
  exactKeys(value.device, ['device_id'], 'invalid_handoff');
  const deviceId = requireUuid(value.device.device_id, 'invalid_handoff', 'Invalid Beta Native handoff.');
  exactKeys(value.profile, ['profile_id', 'display_name'], 'invalid_handoff');
  const profileId = requireUuid(value.profile.profile_id, 'invalid_handoff', 'Invalid Beta Native handoff.');
  if (typeof value.profile.display_name !== 'string') fail('invalid_handoff', 'Invalid Beta Native handoff.');
  exactKeys(value.grant, ['grant_id', 'kind', 'agent_id'], 'invalid_handoff');
  const grantId = requireUuid(value.grant.grant_id, 'invalid_handoff', 'Invalid Beta Native handoff.');
  if (value.grant.kind === 'human') fail('human_grant_forbidden', 'A human grant cannot be used by the monitor adapter.');
  if (!['observer', 'agent_note'].includes(value.grant.kind)) fail('grant_kind_forbidden', 'This Beta grant kind is not supported by the monitor adapter.');
  const agentId = value.grant.agent_id === null
    ? null
    : requireUuid(value.grant.agent_id, 'invalid_handoff', 'Invalid Beta Native handoff.');
  if ((value.grant.kind === 'observer' && agentId !== null) || (value.grant.kind === 'agent_note' && agentId === null)) fail('invalid_handoff', 'Invalid Beta Native handoff.');
  exactKeys(value.credential, ['scheme', 'token'], 'invalid_handoff');
  if (value.credential.scheme !== 'Bearer' || typeof value.credential.token !== 'string' || !/^[a-f0-9]{64}$/i.test(value.credential.token)) fail('invalid_handoff', 'Invalid Beta Native handoff.');
  exactKeys(value.network, ['listener_scope', 'remote_clients_reachable'], 'invalid_handoff');
  if (value.network.listener_scope !== 'loopback_only' || value.network.remote_clients_reachable !== false) fail('invalid_handoff', 'Invalid Beta Native handoff.');
  return { endpoint, protocol: PROTOCOL, deviceId, profileId, grantId, grantKind: value.grant.kind, agentId, token: value.credential.token };
}
function parseTarget(value, handoff) {
  if (!isRecord(value) || typeof value.apiBaseUrl !== 'string' || typeof value.runtimeId !== 'string' || typeof value.profileId !== 'string') {
    fail('explicit_target_required', 'Provide apiBaseUrl, runtimeId and profileId explicitly.');
  }
  const endpoint = parseEndpoint(value.apiBaseUrl);
  const runtimeId = requireUuid(value.runtimeId, 'explicit_target_required', 'Provide a valid runtimeId.');
  const profileId = requireUuid(value.profileId, 'explicit_target_required', 'Provide a valid profileId.');
  if (profileId !== handoff.profileId) fail('profile_handoff_mismatch', 'The selected profile does not match the Native handoff.');
  return { endpoint, runtimeId, profileId };
}
function stableJson(value) {
  const sorted = (input) => {
    if (Array.isArray(input)) return input.map(sorted);
    if (isRecord(input)) return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sorted(input[key])]));
    return input;
  };
  return JSON.stringify(sorted(value));
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function emptyState() {
  return {
    version: 1,
    cursor: 0,
    feeds: {},
    seen: {},
    pendingWait: false,
    pendingCommand: null,
    runtimeId: null,
    rebuildPending: false,
  };
}
function parseState(value) {
  if (value === null || value === undefined) return emptyState();
  if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.cursor) || value.cursor < 0
    || !isRecord(value.feeds) || !isRecord(value.seen) || typeof value.pendingWait !== 'boolean'
    || !(value.pendingCommand === null || isRecord(value.pendingCommand))) fail('invalid_state', 'The monitor cursor state is invalid.');
  const runtimeId = value.runtimeId ?? null;
  const rebuildPending = value.rebuildPending ?? false;
  if ((runtimeId !== null && (typeof runtimeId !== 'string' || !UUID_PATTERN.test(runtimeId)))
    || typeof rebuildPending !== 'boolean') fail('invalid_state', 'The monitor cursor state is invalid.');
  const result = emptyState();
  result.cursor = value.cursor;
  result.pendingWait = value.pendingWait;
  result.runtimeId = runtimeId === null ? null : runtimeId.toLowerCase();
  result.rebuildPending = rebuildPending;
  for (const name of ['captures', 'corrections', 'nodes', 'timeline']) {
    const feed = value.feeds[name];
    if (feed === undefined) continue;
    if (!isRecord(feed) || !Number.isSafeInteger(feed.through) || feed.through < 0
      || !(feed.nextBefore === null || (Number.isSafeInteger(feed.nextBefore) && feed.nextBefore > 0))
      || typeof feed.complete !== 'boolean' || feed.complete !== (feed.nextBefore === null)) fail('invalid_state', 'The monitor cursor state is invalid.');
    result.feeds[name] = { through: feed.through, nextBefore: feed.nextBefore, complete: feed.complete };
  }
  for (const [key, valueDigest] of Object.entries(value.seen)) {
    if (typeof key !== 'string' || key.length !== 73 || key[36] !== ':' || !UUID_PATTERN.test(key.slice(0, 36)) || !UUID_PATTERN.test(key.slice(37)) || typeof valueDigest !== 'string' || !SHA256_PATTERN.test(valueDigest)) fail('invalid_state', 'The monitor cursor state is invalid.');
    result.seen[key] = valueDigest.toLowerCase();
  }
  if (value.pendingCommand !== null) {
    const command = value.pendingCommand;
    if (!isRecord(command) || typeof command.commandId !== 'string' || !UUID_PATTERN.test(command.commandId)
      || typeof command.eventId !== 'string' || !UUID_PATTERN.test(command.eventId)
      || typeof command.payloadDigest !== 'string' || !SHA256_PATTERN.test(command.payloadDigest)
      || !['pending', 'unknown', 'confirmed'].includes(command.status)) fail('invalid_state', 'The monitor cursor state is invalid.');
    result.pendingCommand = { commandId: command.commandId.toLowerCase(), eventId: command.eventId.toLowerCase(), payloadDigest: command.payloadDigest.toLowerCase(), status: command.status };
  }
  trimSeenDigests(result.seen);
  return result;
}
function trimSeenDigests(seen) {
  const keys = Object.keys(seen);
  const excess = Math.max(0, keys.length - MAX_SEEN_FACTS);
  for (const key of keys.slice(0, excess)) delete seen[key];
}

function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function recordOf(item) {
  if (!isRecord(item)) return null;
  if (isRecord(item.record)) return item.record;
  if (isRecord(item.fact)) return item.fact;
  return item;
}
function sequenceOf(item) { const record = recordOf(item); return record?.local_seq ?? item?.local_seq; }
function validatePage(page, profileId, expectedThrough) {
  if (!isRecord(page) || !Array.isArray(page.items) || !Number.isSafeInteger(page.highwater) || page.highwater < 0
    || !(page.next_before === null || (Number.isSafeInteger(page.next_before) && page.next_before > 0))) fail('invalid_page', 'Beta returned an invalid page.');
  if (expectedThrough !== undefined && page.highwater !== expectedThrough) fail('snapshot_mismatch', 'Beta changed the fixed history snapshot.');
  for (const item of page.items) {
    const record = recordOf(item);
    if (!record || record.profile_id !== profileId || typeof record.event_id !== 'string' || !UUID_PATTERN.test(record.event_id)
      || typeof record.digest !== 'string' || !SHA256_PATTERN.test(record.digest) || !Number.isSafeInteger(sequenceOf(item))
      || sequenceOf(item) < 0 || sequenceOf(item) > page.highwater) fail('invalid_page_record', 'Beta returned a record outside the selected profile or snapshot.');
  }
  if (page.next_before !== null && page.items.length === 0) fail('invalid_page_cursor', 'Beta returned a continuation cursor without records.');
  const lastSequence = page.items.length ? sequenceOf(page.items[page.items.length - 1]) : null;
  if (page.next_before !== null && lastSequence !== page.next_before) fail('invalid_page_cursor', 'Beta returned a continuation cursor that does not match the page.');
  return page;
}
function typedTimelineFeed(feed, kind) {
  return {
    ...feed,
    available: true,
    source: 'typed_timeline',
    kind,
    records: feed.records.filter((item) => item?.kind === kind),
  };
}

function unavailableTimelineFeed(through, saved, kind) {
  const before = saved && !saved.complete && saved.through === through ? saved.nextBefore : null;
  return {
    available: false,
    source: 'typed_timeline',
    kind,
    missing_capability: SUMMARY_HISTORY_CAPABILITY,
    pages: [],
    records: [],
    through,
    before,
    next_before: before,
    complete: false,
  };
}

function validateOriginalMetadata(value) {
  if (!isRecord(value) || typeof value.original_id !== 'string' || !UUID_PATTERN.test(value.original_id)
    || typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)
    || !Number.isSafeInteger(value.byte_length) || value.byte_length < 0
    || typeof value.file_name !== 'string' || typeof value.media_type !== 'string') fail('invalid_original_metadata', 'The original reference is invalid.');
  return value;
}
function scopeKey(identity) {
  return `exomind-beta-monitor-v1:${digest(stableJson([identity.deviceId, identity.profileId, identity.grantId, identity.grantKind, identity.agentId]))}`;
}
function validateReadOptions(options) {
  const maxPages = options?.maxPages ?? 100;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) fail('max_pages_out_of_range', 'maxPages must be between 1 and 10000.');
  return maxPages;
}
function validateResponseBudget(value) {
  const maxResponseBytes = value ?? MAX_JSON_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_JSON_RESPONSE_BYTES) {
    fail('max_response_bytes_out_of_range', 'maxResponseBytes must be between 1 and 2097152.');
  }
  return maxResponseBytes;
}

const stateStoreQueues = new WeakMap();
function withStateStoreQueue(stateStore, key, operation) {
  if (!stateStore || (typeof stateStore !== 'object' && typeof stateStore !== 'function')) fail('state_store_required', 'Provide a cursor state store.');
  let scopes = stateStoreQueues.get(stateStore);
  if (!scopes) {
    scopes = new Map();
    stateStoreQueues.set(stateStore, scopes);
  }
  const previous = scopes.get(key) ?? Promise.resolve();
  const running = previous.then(operation);
  scopes.set(key, running.then(() => undefined, () => undefined));
  return running;
}
function samePendingCommand(left, right) {
  return !!left && !!right && left.commandId === right.commandId
    && left.eventId === right.eventId && left.payloadDigest === right.payloadDigest;
}
function pendingStatusRank(status) {
  return status === 'confirmed' ? 2 : status === 'unknown' ? 1 : 0;
}
function mergePendingCommand(current, incoming) {
  if (current && incoming && current.commandId === incoming.commandId && !samePendingCommand(current, incoming)) {
    fail('command_binding_mismatch', 'The fixed command ID is already bound to another event or payload.');
  }
  if (current && current.status !== 'confirmed') {
    if (incoming && !samePendingCommand(current, incoming)) fail('unresolved_command_exists', 'Resolve the fixed pending command before sending another note.');
    if (!incoming) return current;
    return { ...incoming, status: pendingStatusRank(incoming.status) > pendingStatusRank(current.status) ? incoming.status : current.status };
  }
  if (current && !incoming) return current;
  if (current && incoming && samePendingCommand(current, incoming)) {
    return { ...incoming, status: pendingStatusRank(incoming.status) > pendingStatusRank(current.status) ? incoming.status : current.status };
  }
  return incoming ?? null;
}
function mergeStoredState(current, incoming) {
  const next = cloneJson(incoming);
  if (!current) return next;
  const runtimeChanged = !!(incoming.runtimeId && incoming.runtimeId !== current.runtimeId && incoming.rebuildPending);
  if (current.runtimeId && incoming.runtimeId && current.runtimeId !== incoming.runtimeId && !runtimeChanged) {
    fail('runtime_state_conflict', 'A stale monitor runtime cannot replace the qualified cursor state.');
  }
  if (runtimeChanged) {
    const unresolved = current.pendingCommand?.status === 'confirmed' ? null : current.pendingCommand;
    if (unresolved && next.pendingCommand && !samePendingCommand(unresolved, next.pendingCommand)) {
      fail('unresolved_command_exists', 'Resolve the fixed pending command before rebuilding this runtime cursor.');
    }
    next.pendingCommand = next.pendingCommand ?? unresolved;
    return next;
  }
  next.pendingCommand = mergePendingCommand(current.pendingCommand, next.pendingCommand);
  return next;
}
function decidePendingReservation(existing, pending) {
  if (existing && existing.commandId === pending.commandId && !samePendingCommand(existing, pending)) {
    fail('command_binding_mismatch', 'The fixed command ID is already bound to another event or payload.');
  }
  if (existing && samePendingCommand(existing, pending)) return { status: 'existing', pendingCommand: existing };
  if (existing && existing.status !== 'confirmed') fail('unresolved_command_exists', 'Resolve the fixed pending command before sending another note.');
  return { status: 'reserved', pendingCommand: { ...pending, status: 'pending' } };
}
async function reserveJournalCommand(stateStore, key, pending) {
  return withStateStoreQueue(stateStore, key, async () => {
    if (typeof stateStore.reservePendingCommand === 'function') {
      const result = await stateStore.reservePendingCommand(key, pending);
      if (result === null || result === undefined) return { status: 'reserved', pendingCommand: { ...pending, status: 'pending' } };
      if (!isRecord(result) || !['reserved', 'existing'].includes(result.status)) fail('invalid_command_reservation', 'The cursor store returned an invalid command reservation.');
      const checked = parseState({ ...emptyState(), pendingCommand: result.pendingCommand });
      if (!samePendingCommand(checked.pendingCommand, pending)) fail('invalid_command_reservation', 'The cursor store reserved another command.');
      return { status: result.status, pendingCommand: checked.pendingCommand };
    }
    const stored = await stateStore.load(key);
    const current = parseState(stored);
    const result = decidePendingReservation(current.pendingCommand, pending);
    if (result.status === 'reserved') await stateStore.save(key, { ...current, pendingCommand: result.pendingCommand });
    return result;
  });
}
export function createBetaMonitorAdapter({ handoff, target, stateStore, fetchImpl = fetch } = {}) {
  let parsedHandoff;
  let selectedTarget;
  let identity;
  let access;
  let key;
  let state = emptyState();
  let connected = false;
  let stopped = false;
  let stopPromise;
  let recoveryWaitPending = false;
  let unresolvedWait = false;
  let originals = new Map();
  let saveQueue = Promise.resolve();
  const activeWaits = new Set();
  const activeRequests = new Set();
  const activeOperations = new Set();

  function ensureConnected() {
    if (!connected) fail('not_connected', 'Connect the Beta monitor adapter first.');
    if (stopped) fail('adapter_stopped', 'The Beta monitor adapter has stopped.');
  }
  function ensureNotStopped() {
    if (stopped) fail('request_cancelled', 'The Beta request was cancelled.');
  }
  function trackOperation(operation) {
    const running = Promise.resolve().then(operation);
    activeOperations.add(running);
    running.then(() => activeOperations.delete(running), () => activeOperations.delete(running));
    return running;
  }
  async function persist({ allowStopped = false } = {}) {
    if (!key || !stateStore || typeof stateStore.save !== 'function' || typeof stateStore.load !== 'function') fail('state_store_required', 'A cursor state store is required.');
    const snapshot = cloneJson(state);
    const write = saveQueue.then(() => withStateStoreQueue(stateStore, key, async () => {
      if (stopped && !allowStopped) fail('request_cancelled', 'The Beta request was cancelled.');
      const stored = await stateStore.load(key);
      if (stopped && !allowStopped) fail('request_cancelled', 'The Beta request was cancelled.');
      const current = stored === null || stored === undefined ? null : parseState(stored);
      const merged = mergeStoredState(current, snapshot);
      await stateStore.save(key, merged);
      if (stopped && !allowStopped) fail('request_cancelled', 'The Beta request was cancelled.');
    }));
    saveQueue = write.catch(() => {});
    await write;
  }
  function urlFor(path) {
    return new URL(`${selectedTarget.endpoint.prefix}${path}`, `${selectedTarget.endpoint.origin}/`).href;
  }
  function beginRequest(signal, cancelCode) {
    if (stopped || signal?.aborted) fail(cancelCode ?? 'request_cancelled', 'The Beta request was cancelled.');
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (signal) signal.addEventListener('abort', abortFromCaller, { once: true });
    const request = {
      controller,
      finished: false,
      assertActive() {
        if (stopped || controller.signal.aborted) fail(cancelCode ?? 'request_cancelled', 'The Beta request was cancelled.');
      },
      finish() {
        if (request.finished) return;
        request.finished = true;
        if (signal) signal.removeEventListener('abort', abortFromCaller);
        activeRequests.delete(request);
      },
    };
    activeRequests.add(request);
    return request;
  }
  async function responseFor(method, path, { body, authenticated = true, signal, cancelCode } = {}) {
    const headers = { Accept: 'application/json' };
    if (authenticated) headers.Authorization = `Bearer ${parsedHandoff.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const request = beginRequest(signal, cancelCode);
    try {
      request.assertActive();
      const response = await fetchImpl(urlFor(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: request.controller.signal,
      });
      request.assertActive();
      return { response, request };
    } catch (error) {
      request.finish();
      if (error instanceof BetaMonitorError) throw error;
      if (stopped || request.controller.signal.aborted) fail(cancelCode ?? 'request_cancelled', 'The Beta request was cancelled.');
      fail('network_error', 'The Beta request did not complete.');
    }
  }
  async function readBoundedResponseText(response, request, maxBytes) {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        let result;
        try {
          result = await reader.read();
        } catch (error) {
          request.assertActive();
          if (error instanceof BetaMonitorError) throw error;
          fail('invalid_response', 'Beta returned an unreadable JSON response.');
        }
        request.assertActive();
        if (result.done) break;
        const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
        if (chunk.byteLength > maxBytes - total) {
          try { await reader.cancel(); } catch { /* stop retaining an oversized response */ }
          request.assertActive();
          fail('response_too_large', 'Beta JSON response exceeded its byte budget.');
        }
        chunks.push(chunk);
        total += chunk.byteLength;
      }
    } finally {
      try { reader.releaseLock(); } catch { /* the stream may already be cancelled */ }
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
    } catch {
      fail('invalid_response', 'Beta returned invalid UTF-8 JSON.');
    }
  }
  async function jsonRequest(method, path, options = {}) {
    const maxResponseBytes = validateResponseBudget(options.maxResponseBytes);
    const { response, request } = await responseFor(method, path, options);
    try {
      let value = null;
      if (response.status !== 204) {
        try {
          const text = await readBoundedResponseText(response, request, maxResponseBytes);
          request.assertActive();
          value = text.length === 0 ? null : JSON.parse(text);
        } catch (error) {
          request.assertActive();
          if (error instanceof BetaMonitorError) throw error;
          fail('invalid_response', 'Beta returned an invalid JSON response.');
        }
      }
      request.assertActive();
      if (!response.ok) {
        const code = isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string'
          ? value.error.code : `http_${response.status}`;
        throw new BetaMonitorError(code, `Beta request failed with HTTP ${response.status}.`, response.status);
      }
      return value;
    } finally {
      request.finish();
    }
  }

  function verifyAccess(value, required) {
    if (!isRecord(value) || value.protocol !== PROTOCOL || value.runtime_id !== selectedTarget.runtimeId
      || value.device_id !== parsedHandoff.deviceId || value.profile_id !== selectedTarget.profileId
      || value.grant_kind !== parsedHandoff.grantKind || (value.agent_id ?? null) !== parsedHandoff.agentId
      || !Array.isArray(value.allowed)) fail('grant_identity_mismatch', 'The Beta grant does not match the selected identity.');
    const allowed = new Set(value.allowed.filter((item) => typeof item === 'string'));
    if (required.some((capability) => !allowed.has(capability))) fail('required_capability_missing', 'The Beta grant lacks a required capability.');
    const chunkBytes = value.max_original_chunk_bytes;
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > MAX_ORIGINAL_CHUNK_BYTES) fail('invalid_original_limit', 'Beta returned an invalid original byte limit.');
    return value;
  }
  async function ensureCapabilities(required) {
    const checked = await jsonRequest('POST', `/profiles/${encodeURIComponent(selectedTarget.profileId)}/access/check`, { body: { required } });
    return verifyAccess(checked, required);
  }
  function connect() {
    return trackOperation(async () => {
      if (connected) return { ...identity };
      if (stopped) fail('adapter_stopped', 'The Beta monitor adapter has stopped.');
      if (!stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function') fail('state_store_required', 'Provide a cursor state store.');
      parsedHandoff = parseHandoff(handoff);
      selectedTarget = parseTarget(target, parsedHandoff);
      const hello = await jsonRequest('GET', '/hello', { authenticated: false });
      ensureNotStopped();
      if (!isRecord(hello) || hello.protocol !== PROTOCOL) fail('protocol_mismatch', 'The selected endpoint does not speak exomind-beta/1.');
      if (hello.running !== true || hello.runtime_id !== selectedTarget.runtimeId || hello.device_id !== parsedHandoff.deviceId) {
        fail('runtime_or_device_mismatch', 'The selected endpoint identity does not match the explicit target.');
      }
      access = await ensureCapabilities(READ_CAPABILITIES);
      ensureNotStopped();
      identity = {
        protocol: PROTOCOL,
        runtimeId: selectedTarget.runtimeId,
        deviceId: parsedHandoff.deviceId,
        profileId: selectedTarget.profileId,
        grantId: parsedHandoff.grantId,
        grantKind: parsedHandoff.grantKind,
        agentId: parsedHandoff.agentId,
      };
      key = scopeKey(identity);
      let stored;
      try { stored = await stateStore.load(key); }
      catch (error) {
        if (error instanceof BetaMonitorError) throw error;
        fail('state_load_failed', 'The monitor cursor state could not be loaded.');
      }
      ensureNotStopped();
      state = parseState(stored);
      const runtimeChanged = stored !== null && stored !== undefined && state.runtimeId !== identity.runtimeId;
      if (runtimeChanged) {
        const unresolved = state.pendingCommand && state.pendingCommand.status !== 'confirmed' ? state.pendingCommand : null;
        state = emptyState();
        state.pendingCommand = unresolved;
        state.rebuildPending = true;
      }
      state.runtimeId = identity.runtimeId;
      recoveryWaitPending = state.pendingWait;
      if (runtimeChanged) await persist();
      ensureNotStopped();
      connected = true;
      return { ...identity };
    });
  }
  function trackItem(item) {
    const record = recordOf(item);
    const keyPart = `${record.profile_id}:${record.event_id.toLowerCase()}`;
    const recordDigest = record.digest.toLowerCase();
    const previous = state.seen[keyPart];
    if (previous && previous !== recordDigest) fail('fact_digest_conflict', 'The same Beta fact ID was returned with a different digest.');
    delete state.seen[keyPart];
    state.seen[keyPart] = recordDigest;
    trimSeenDigests(state.seen);
  }
  async function readFeed(name, suffix, through, maxPages, fresh = false, maxResponseBytes = MAX_JSON_RESPONSE_BYTES, skipCompletedAtSameThrough = false) {
    const saved = state.feeds[name];
    // Opt-in aggregate reads must not restart a feed already complete at this snapshot.
    if (skipCompletedAtSameThrough && !fresh && through !== undefined && saved?.complete && saved.through === through) {
      return { pages: [], records: [], through, before: null, next_before: null, complete: true };
    }
    const resumeSnapshot = !fresh && saved && !saved.complete && (through === undefined || through === saved.through);
    let fixedThrough = through ?? (resumeSnapshot ? saved.through : undefined);
    let before = resumeSnapshot ? saved.nextBefore : null;
    const firstBefore = before;
    const pages = [];
    const records = [];
    let nextBefore = before;
    let complete = false;
    let pageLimit = PAGE_LIMIT;
    let pagesRead = 0;
    while (pagesRead < maxPages) {
      let page;
      while (true) {
        const params = new URLSearchParams({ limit: String(pageLimit) });
        if (fixedThrough !== undefined) params.set('through', String(fixedThrough));
        if (before !== null) params.set('before', String(before));
        const path = `/profiles/${encodeURIComponent(selectedTarget.profileId)}${suffix}?${params}`;
        try {
          page = await jsonRequest('GET', path, { maxResponseBytes });
          break;
        } catch (error) {
          if (!(error instanceof BetaMonitorError) || error.code !== 'response_too_large') throw error;
          if (pageLimit <= 1) fail('record_too_large', 'One Beta history record exceeds maxResponseBytes.');
          pageLimit = Math.max(1, Math.floor(pageLimit / 2));
        }
      }
      ensureConnected();
      validatePage(page, selectedTarget.profileId, fixedThrough);
      if (fixedThrough === undefined) fixedThrough = page.highwater;
      for (const item of page.items) { trackItem(item); records.push(item); }
      pages.push(page);
      nextBefore = page.next_before;
      complete = nextBefore === null;
      state.feeds[name] = { through: fixedThrough, nextBefore, complete };
      await persist();
      ensureConnected();
      pagesRead += 1;
      if (complete) break;
      if (before !== null && nextBefore >= before) fail('invalid_page_cursor', 'Beta returned a non-decreasing continuation cursor.');
      before = nextBefore;
    }
    return { pages, records, through: fixedThrough, before: firstBefore, next_before: nextBefore, complete };
  }

  async function readSnapshot(options = {}) {
    const maxPages = Math.min(validateReadOptions(options), MAX_READ_HISTORY_PAGES_PER_FEED);
    if (options.includeSummaryFeeds !== undefined && typeof options.includeSummaryFeeds !== 'boolean') {
      fail('invalid_read_history_option', 'includeSummaryFeeds must be a boolean.');
    }
    const includeSummaryFeeds = options.includeSummaryFeeds === true;
    const maxResponseBytes = validateResponseBudget(options.maxResponseBytes);
    const explicitThrough = options.through;
    if (explicitThrough !== undefined && (!Number.isSafeInteger(explicitThrough) || explicitThrough < 0)) {
      fail('invalid_through', 'through must be a non-negative local sequence.');
    }
    let through = explicitThrough;
    const fresh = options.fresh === true;
    if (through === undefined && !fresh) {
      const candidates = ['captures', 'corrections', 'nodes'];
      if (includeSummaryFeeds) candidates.push('timeline');
      const incomplete = candidates.map((name) => state.feeds[name]).find((feed) => feed && !feed.complete);
      if (incomplete) through = incomplete.through;
    }
    const captures = await readFeed('captures', '/events', through, maxPages, fresh, maxResponseBytes, includeSummaryFeeds);
    ensureConnected();
    through = captures.through;
    const corrections = await readFeed('corrections', '/corrections', through, maxPages, fresh, maxResponseBytes, includeSummaryFeeds);
    ensureConnected();
    const nodes = await readFeed('nodes', '/timeblocks/nodes', through, maxPages, fresh, maxResponseBytes, includeSummaryFeeds);
    ensureConnected();

    let timelineAvailable = false;
    let summaryHistoryComplete = false;
    let summaries;
    let agentSummaries;
    if (includeSummaryFeeds) {
      timelineAvailable = Array.isArray(access?.allowed) && access.allowed.includes(SUMMARY_HISTORY_CAPABILITY);
      if (timelineAvailable) {
        const timeline = await readFeed('timeline', '/timeline', through, maxPages, fresh, maxResponseBytes, includeSummaryFeeds);
        ensureConnected();
        summaries = typedTimelineFeed(timeline, SUMMARY_HISTORY_KINDS.summaries);
        agentSummaries = typedTimelineFeed(timeline, SUMMARY_HISTORY_KINDS.agentSummaries);
        summaryHistoryComplete = timeline.complete;
      } else {
        const savedTimeline = state.feeds.timeline;
        summaries = unavailableTimelineFeed(through, savedTimeline, SUMMARY_HISTORY_KINDS.summaries);
        agentSummaries = unavailableTimelineFeed(through, savedTimeline, SUMMARY_HISTORY_KINDS.agentSummaries);
      }
    }

    const current = await jsonRequest(
      'GET',
      '/profiles/' + encodeURIComponent(selectedTarget.profileId) + '/timeblocks/current',
      { maxResponseBytes },
    );
    ensureConnected();
    if (!isRecord(current) || current.profile_id !== selectedTarget.profileId) {
      fail('invalid_timeblock_snapshot', 'Beta returned a timeblock snapshot for another profile.');
    }
    originals = new Map();
    for (const item of captures.records) {
      const record = recordOf(item);
      if (!Array.isArray(record.originals)) continue;
      for (const original of record.originals) {
        validateOriginalMetadata(original);
        const originalId = original.original_id.toLowerCase();
        const existing = originals.get(originalId);
        if (existing && (existing.sha256 !== original.sha256 || existing.byte_length !== original.byte_length)) {
          fail('original_reference_conflict', 'The same original ID was returned with conflicting metadata.');
        }
        originals.set(originalId, original);
      }
    }
    const complete = captures.complete && corrections.complete && nodes.complete;
    const fullHistoryComplete = includeSummaryFeeds && complete && timelineAvailable && summaryHistoryComplete;
    const rebuilt = state.rebuildPending;
    if (complete) {
      state.cursor = Math.max(state.cursor, through ?? 0);
      state.rebuildPending = false;
      await persist();
      ensureConnected();
    }
    const agentMessages = captures.records.filter((item) => recordOf(item)?.author_kind === 'agent_note');
    const feeds = { captures, corrections };
    if (includeSummaryFeeds) {
      feeds.summaries = summaries;
      feeds.agentSummaries = agentSummaries;
    }
    return {
      feeds,
      timeblocks: { nodes, current },
      agentMessages,
      through,
      cursor: {
        after_local_seq: state.cursor,
        complete,
        rebuilt,
        captures: { through: captures.through, next_before: captures.next_before },
        corrections: { through: corrections.through, next_before: corrections.next_before },
        timeblocks: { through: nodes.through, next_before: nodes.next_before },
      },
      ...(includeSummaryFeeds
        ? {
            coverage: {
              scope: 'beta_public_typed_history',
              included_typed_kinds: [...PUBLIC_HISTORY_TYPED_KINDS],
              full_history_complete: fullHistoryComplete,
            },
          }
        : {}),
    };
  }
  function readHistory(options = {}) {
    return trackOperation(async () => {
      ensureConnected();
      return readSnapshot(options);
    });
  }
  async function binaryRange(originalId, offset, length) {
    const params = new URLSearchParams({ offset: String(offset), length: String(length) });
    const { response, request } = await responseFor('GET', `/profiles/${encodeURIComponent(selectedTarget.profileId)}/originals/${encodeURIComponent(originalId)}/bytes?${params}`);
    try {
      if (!response.ok) {
        let code = `http_${response.status}`;
        try {
          const text = await readBoundedResponseText(response, request, MAX_JSON_RESPONSE_BYTES);
          request.assertActive();
          const value = text.length === 0 ? null : JSON.parse(text);
          if (isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string') code = value.error.code;
        } catch (error) {
          request.assertActive();
          if (error instanceof BetaMonitorError && error.code !== 'invalid_response') throw error;
        }
        throw new BetaMonitorError(code, `Beta original read failed with HTTP ${response.status}.`, response.status);
      }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/octet-stream')) fail('invalid_original_range', 'Beta returned a non-binary original response.');
      const reader = response.body?.getReader();
      if (!reader) fail('invalid_original_range', 'Beta returned an unreadable original response.');
      const bytes = new Uint8Array(length);
      let written = 0;
      try {
        while (true) {
          let result;
          try { result = await reader.read(); }
          catch (error) {
            request.assertActive();
            if (error instanceof BetaMonitorError) throw error;
            fail('network_error', 'The Beta original range did not complete.');
          }
          request.assertActive();
          if (result.done) break;
          const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
          if (chunk.byteLength > length - written) {
            try { await reader.cancel(); } catch { /* stop retaining an oversized response */ }
            fail('invalid_original_range', 'Beta returned more bytes than requested.');
          }
          bytes.set(chunk, written);
          written += chunk.byteLength;
        }
      } finally {
        try { reader.releaseLock(); } catch { /* the stream may already be cancelled */ }
      }
      request.assertActive();
      return bytes.subarray(0, written);
    } catch (error) {
      request.assertActive();
      if (error instanceof BetaMonitorError) throw error;
      fail('network_error', 'The Beta original range did not complete.');
    } finally {
      request.finish();
    }
  }
  async function verifiedOriginal(id, metadata, onChunk) {
    const chunkLimit = Math.min(access.max_original_chunk_bytes, MAX_ORIGINAL_CHUNK_BYTES);
    const hash = createHash('sha256');
    let offset = 0;
    if (metadata.byte_length === 0) {
      const empty = await binaryRange(id, 0, 1);
      ensureConnected();
      if (empty.byteLength !== 0) fail('invalid_original_range', 'The empty original returned unexpected bytes.');
    } else {
      while (offset < metadata.byte_length) {
        const length = Math.min(chunkLimit, metadata.byte_length - offset);
        const bytes = await binaryRange(id, offset, length);
        ensureConnected();
        if (bytes.byteLength !== length) fail('invalid_original_range', 'Beta returned an incomplete original range.');
        hash.update(bytes);
        await onChunk(bytes, offset);
        ensureConnected();
        offset += bytes.byteLength;
      }
    }
    const actualSha = hash.digest('hex');
    if (offset !== metadata.byte_length || actualSha !== metadata.sha256.toLowerCase()) fail('original_integrity_mismatch', 'The original bytes do not match the referenced length and SHA-256.');
    return { metadata, byteLength: offset, sha256: actualSha };
  }
  function originalReference(originalId) {
    const id = requireUuid(originalId, 'invalid_original_id', 'originalId must be a UUID.').toLowerCase();
    const metadata = originals.get(id);
    if (!metadata) fail('original_not_in_snapshot', 'Read a history snapshot containing this original before requesting it.');
    return { id, metadata };
  }
  function readOriginal(originalId, options = {}) {
    return trackOperation(async () => {
      ensureConnected();
      const { id, metadata } = originalReference(originalId);
      if (options.includeBytes !== true) return { metadata, bytes: null };
      const maxBufferedBytes = options.maxBufferedBytes ?? MAX_ORIGINAL_BUFFER_BYTES;
      if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 0 || maxBufferedBytes > MAX_ORIGINAL_BUFFER_BYTES) fail('invalid_original_buffer_budget', `maxBufferedBytes must be between 0 and ${MAX_ORIGINAL_BUFFER_BYTES}.`);
      if (metadata.byte_length > maxBufferedBytes) fail('original_buffer_budget_exceeded', 'The original exceeds the requested in-memory budget; use streamOriginal instead.');
      const bytes = new Uint8Array(metadata.byte_length);
      const verified = await verifiedOriginal(id, metadata, (chunk, offset) => { bytes.set(chunk, offset); });
      return { ...verified, bytes };
    });
  }
  function streamOriginal(originalId, options = {}) {
    return trackOperation(async () => {
      ensureConnected();
      if (!options || typeof options.onChunk !== 'function') fail('original_chunk_callback_required', 'Provide an onChunk callback for streamed original bytes.');
      const { id, metadata } = originalReference(originalId);
      return verifiedOriginal(id, metadata, async (chunk) => {
        ensureConnected();
        await options.onChunk(chunk);
        ensureConnected();
      });
    });
  }
  async function recoverPendingWait() {
    const snapshot = await readSnapshot({ fresh: true });
    if (snapshot.cursor.complete) {
      state.pendingWait = false;
      recoveryWaitPending = false;
      unresolvedWait = false;
      await persist();
    }
    return { ...snapshot, result: 'recovered' };
  }
  function wait(options = {}) {
    return trackOperation(async () => {
      ensureConnected();
      const timeoutMs = options.timeoutMs ?? 30000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('wait_timeout_out_of_range', 'timeoutMs must be between 1 and 30000.');
      if (options.signal?.aborted) fail('wait_cancelled', 'The Beta wait was cancelled.');
      if (recoveryWaitPending && activeWaits.size === 0) return recoverPendingWait();
      if (activeWaits.size >= 4) fail('wait_concurrency_limit', 'At most four Beta waits may be active in one adapter.');
      if (activeWaits.size === 0) unresolvedWait = false;

      const controller = new AbortController();
      const externalSignal = options.signal;
      const abortFromCaller = () => controller.abort();
      if (externalSignal) externalSignal.addEventListener('abort', abortFromCaller, { once: true });
      const entry = { controller, promise: null };
      activeWaits.add(entry);
      state.pendingWait = true;
      recoveryWaitPending = false;

      const operation = (async () => {
        let confirmed = false;
        let shouldClearPending = false;
        try {
          await persist();
          if (stopped || controller.signal.aborted) fail('wait_cancelled', 'The Beta wait was cancelled.');
          const afterLocalSeq = state.cursor;
          const result = await jsonRequest('POST', `/profiles/${encodeURIComponent(selectedTarget.profileId)}/wait`, {
            body: { after_local_seq: afterLocalSeq, timeout_ms: timeoutMs },
            signal: controller.signal,
            cancelCode: 'wait_cancelled',
          });
          if (stopped || controller.signal.aborted) fail('wait_cancelled', 'The Beta wait was cancelled.');
          if (!isRecord(result) || result.profile_id !== selectedTarget.profileId || result.after_local_seq !== afterLocalSeq
            || !['changed', 'timeout'].includes(result.state) || !(result.highwater === null || (Number.isSafeInteger(result.highwater) && result.highwater >= 0)) || (result.state === 'changed' && !Number.isSafeInteger(result.highwater))) fail('invalid_wait_response', 'Beta returned an invalid Wait response.');
          confirmed = true;
          if (result.state === 'timeout') {
            shouldClearPending = true;
            return { result: 'timeout', highwater: result.highwater };
          }
          const snapshot = await readSnapshot({ through: result.highwater });
          if (stopped || controller.signal.aborted) fail('wait_cancelled', 'The Beta wait was cancelled.');
          shouldClearPending = snapshot.cursor.complete;
          return { ...snapshot, result: 'changed', highwater: result.highwater };
        } catch (error) {
          if (stopped || controller.signal.aborted || error?.code === 'wait_cancelled') {
            unresolvedWait = true;
            throw new BetaMonitorError('wait_cancelled', 'The Beta wait was cancelled.');
          }
          if (!confirmed || !shouldClearPending) unresolvedWait = true;
          throw error instanceof BetaMonitorError ? error : new BetaMonitorError('wait_failed', 'The Beta wait did not complete.');
        } finally {
          if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
          activeWaits.delete(entry);
          if (activeWaits.size === 0) {
            if (confirmed && shouldClearPending && !unresolvedWait) {
              state.pendingWait = false;
              recoveryWaitPending = false;
            } else {
              state.pendingWait = true;
              if (confirmed && !shouldClearPending) recoveryWaitPending = true;
            }
            await persist({ allowStopped: true });
          }
        }
      })();
      entry.promise = operation;
      return operation;
    });
  }
  function validateAgentNote(command) {
    if (!isRecord(command)) fail('invalid_agent_note', 'An agent_note command is required.');
    const commandId = requireUuid(command.command_id, 'invalid_agent_note', 'command_id must be a UUID.').toLowerCase();
    const eventId = requireUuid(command.event_id, 'invalid_agent_note', 'event_id must be a UUID.').toLowerCase();
    if (command.profile_id !== selectedTarget.profileId || !Number.isSafeInteger(command.occurred_at_ms) || command.occurred_at_ms < 0
      || typeof command.text !== 'string' || Buffer.byteLength(command.text, 'utf8') > 128 * 1024
      || !Array.isArray(command.tags) || command.tags.length > 64
      || command.tags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0 || Buffer.byteLength(tag, 'utf8') > 128)
      || !Array.isArray(command.originals) || command.originals.length > 256) fail('invalid_agent_note', 'The agent_note body is invalid or belongs to another profile.');
    if (command.text.trim().length === 0 && command.originals.length === 0) fail('invalid_agent_note', 'An agent_note must contain text or an original reference.');
    const body = {
      command_id: commandId,
      event_id: eventId,
      profile_id: selectedTarget.profileId,
      occurred_at_ms: command.occurred_at_ms,
      text: command.text,
      tags: [...command.tags],
      originals: command.originals.map((item) => validateOriginalMetadata(item)),
    };
    return { body, commandId, eventId, payloadDigest: digest(stableJson(body)) };
  }
  function validateReceipt(value, pending) {
    if (!isRecord(value) || value.command_id !== pending.commandId || value.event_id !== pending.eventId
      || value.profile_id !== selectedTarget.profileId || value.durability !== 'local_committed'
      || !Number.isSafeInteger(value.local_seq) || value.local_seq < 0
      || typeof value.event_digest !== 'string' || !SHA256_PATTERN.test(value.event_digest)) fail('receipt_mismatch', 'The fixed Beta command receipt does not match the submitted IDs.');
    return value;
  }
  async function readReceipt(pending) {
    try {
      const value = await jsonRequest('GET', `/profiles/${encodeURIComponent(selectedTarget.profileId)}/receipts/${encodeURIComponent(pending.commandId)}`);
      return value === null ? null : validateReceipt(value, pending);
    } catch (error) {
      if (error?.status === 404 || error?.code === 'not_found') return null;
      throw error;
    }
  }
  function sendAgentNote(command) {
    return trackOperation(async () => {
      ensureConnected();
      if (parsedHandoff.grantKind !== 'agent_note') fail('agent_note_grant_required', 'Sending a note requires an agent_note grant.');
      const input = validateAgentNote(command);
      const writeAccess = await ensureCapabilities(['capture_append_agent_note', 'timeline_read']);
      ensureConnected();
      const pending = { commandId: input.commandId, eventId: input.eventId, payloadDigest: input.payloadDigest, status: 'pending' };
      const reservation = await reserveJournalCommand(stateStore, key, pending);
      ensureConnected();
      state.pendingCommand = reservation.pendingCommand;
      if (reservation.status === 'reserved') {
        try {
          const created = await jsonRequest('POST', '/capture', { body: input.body });
          ensureConnected();
          if (created !== null) validateReceipt(created, pending);
        } catch (error) {
          if (error instanceof BetaMonitorError
            && (error.code === 'request_cancelled' || error.code === 'adapter_stopped'
              || (error.status !== undefined && error.status < 500 && error.code !== 'network_error'))) throw error;
        }
        ensureConnected();
        state.pendingCommand = { ...pending, status: 'unknown' };
        await persist();
        ensureConnected();
      }
      const receipt = await readReceipt(pending);
      ensureConnected();
      if (!receipt) {
        if (state.pendingCommand && state.pendingCommand.status === 'pending') {
          state.pendingCommand = { ...pending, status: 'unknown' };
          await persist();
          ensureConnected();
        }
        return { result: 'unknown', command_id: pending.commandId, event_id: pending.eventId };
      }
      const timelineItem = await jsonRequest('GET', `/profiles/${encodeURIComponent(selectedTarget.profileId)}/timeline/events/${encodeURIComponent(pending.eventId)}`);
      ensureConnected();
      const record = recordOf(timelineItem);
      if (!record || record.event_id !== pending.eventId || record.profile_id !== selectedTarget.profileId
        || record.digest !== receipt.event_digest || record.author_kind !== 'agent_note' || record.author_id !== writeAccess.agent_id) fail('agent_note_readback_mismatch', 'The exact Beta event did not match its fixed receipt and grant author.');
      state.pendingCommand = { ...pending, status: 'confirmed' };
      await persist();
      ensureConnected();
      return { result: 'confirmed', receipt, event: record };
    });
  }
  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true;
    for (const request of activeRequests) request.controller.abort();
    for (const entry of activeWaits) entry.controller.abort();
    stopPromise = (async () => {
      await Promise.allSettled([...activeOperations]);
      await saveQueue;
      if (connected && state.pendingWait) {
        recoveryWaitPending = true;
        await persist({ allowStopped: true });
      }
    })();
    return stopPromise;
  }

  return { connect, readHistory, readOriginal, streamOriginal, wait, sendAgentNote, stop };
}

function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function createFileStateStore(statePath) {
  if (typeof statePath !== 'string' || !isAbsolute(statePath)) fail('explicit_state_path_required', 'Provide an absolute statePath in the user data directory.');
  const absolutePath = resolve(statePath);
  const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (isInside(absolutePath, skillRoot)) fail('unsafe_state_path', 'Monitor state cannot be written inside the Skill installation.');
  const lockPath = absolutePath + '.lock';
  let chain = Promise.resolve();
  const enqueue = (operation) => {
    const running = chain.then(operation);
    chain = running.catch(() => {});
    return running;
  };
  async function releaseLock(lockHandle, openedStat) {
    try {
      await lockHandle.close();
    } catch {
      fail('state_lock_release_failed', 'The monitor state lock could not be closed; inspect ' + lockPath + '.');
    }
    if (!openedStat) fail('state_lock_release_failed', 'The monitor state lock ownership could not be verified; inspect ' + lockPath + '.');
    let currentStat;
    try {
      currentStat = await fs.lstat(lockPath);
    } catch (error) {
      if (error?.code === 'ENOENT') fail('state_lock_lost', 'The monitor state lock disappeared while held; inspect ' + lockPath + '.');
      fail('state_lock_release_failed', 'The monitor state lock could not be inspected; inspect ' + lockPath + '.');
    }
    if (currentStat.dev !== openedStat.dev || currentStat.ino !== openedStat.ino) {
      fail('state_lock_lost', 'The state lock changed while held; the current lock was left untouched at ' + lockPath + '.');
    }
    try {
      await fs.unlink(lockPath);
    } catch {
      fail('state_lock_release_failed', 'The owned monitor state lock could not be removed; inspect ' + lockPath + '.');
    }
  }
  async function withJournalLock(operation) {
    try {
      await fs.mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
    } catch {
      fail('state_lock_failed', 'The monitor state lock directory could not be prepared.');
    }
    let lockHandle;
    try {
      lockHandle = await fs.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') fail('journal_busy', 'The monitor state journal is locked; retry later and inspect ' + lockPath + ' before any manual cleanup.');
      fail('state_lock_failed', 'The monitor state lock could not be acquired.');
    }
    let openedStat = null;
    try {
      openedStat = await lockHandle.stat();
      await lockHandle.writeFile(JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }), 'utf8');
      await lockHandle.sync();
      return await operation();
    } catch (error) {
      if (error instanceof BetaMonitorError) throw error;
      fail('state_lock_failed', 'The monitor state lock could not be initialized.');
    } finally {
      await releaseLock(lockHandle, openedStat);
    }
  }
  async function readState(key) {
    let handle;
    try {
      handle = await fs.open(absolutePath, 'r');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('state_load_failed', 'The monitor cursor state could not be loaded.');
    }
    try {
      const before = await handle.stat();
      if (!before.isFile()) fail('state_load_failed', 'The monitor cursor state is not a regular file.');
      if (before.size > MAX_FILE_STATE_BYTES) fail('state_too_large', 'The monitor cursor state exceeds 512 KiB and was left unchanged.');
      const bytes = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size > MAX_FILE_STATE_BYTES || offset > MAX_FILE_STATE_BYTES) fail('state_too_large', 'The monitor cursor state exceeds 512 KiB and was left unchanged.');
      if (before.size !== after.size || offset !== after.size) fail('state_load_failed', 'The monitor cursor state changed while it was being read.');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
      const envelope = JSON.parse(raw);
      if (!isRecord(envelope) || envelope.scopeKey !== key || !isRecord(envelope.state)) fail('state_scope_mismatch', 'The cursor file belongs to another Beta identity.');
      return parseState(envelope.state);
    } catch (error) {
      if (error instanceof BetaMonitorError) throw error;
      fail('state_load_failed', 'The monitor cursor state could not be loaded.');
    } finally {
      try {
        await handle.close();
      } catch {
        fail('state_load_failed', 'The monitor cursor state file could not be closed.');
      }
    }
  }
  async function writeState(key, state) {
    const serialized = JSON.stringify({ version: 1, scopeKey: key, state });
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_STATE_BYTES) {
      fail('state_too_large', 'The monitor cursor state exceeds 512 KiB; the previous state file was left unchanged.');
    }
    const tempPath = absolutePath + '.' + process.pid + '.' + randomBytes(6).toString('hex') + '.tmp';
    try {
      await fs.writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(tempPath, absolutePath);
    } catch {
      try { await fs.rm(tempPath, { force: true }); } catch { /* best effort cleanup */ }
      fail('state_save_failed', 'The monitor cursor state could not be saved.');
    }
  }
  return {
    async load(key) {
      return enqueue(() => withJournalLock(() => readState(key)));
    },
    async save(key, value) {
      return enqueue(() => withJournalLock(async () => {
        const current = await readState(key);
        const incoming = parseState(value);
        await writeState(key, mergeStoredState(current, incoming));
      }));
    },
    async reservePendingCommand(key, value) {
      const pending = parseState({ ...emptyState(), pendingCommand: value }).pendingCommand;
      return enqueue(() => withJournalLock(async () => {
        const current = await readState(key) ?? emptyState();
        const reservation = decidePendingReservation(current.pendingCommand, pending);
        if (reservation.status === 'reserved') {
          await writeState(key, { ...current, pendingCommand: reservation.pendingCommand });
        }
        return reservation;
      }));
    },
  };
}

async function readStdin() {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.byteLength > MAX_CLI_STDIN_BYTES - byteLength) fail('stdin_limit_exceeded', 'CLI stdin exceeds the 256 KiB input limit.');
    byteLength += bytes.byteLength;
    chunks.push(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, byteLength));
  } catch {
    fail('invalid_utf8', 'CLI stdin must contain valid UTF-8.');
  }
}
function toCliJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array) return { encoding: 'base64', data: Buffer.from(item).toString('base64') };
    return item;
  });
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const input = JSON.parse(await readStdin());
    if (!isRecord(input)) fail('invalid_input', 'CLI input must be a JSON object.');
    if (!input.handoff) fail('native_handoff_required', 'Provide the exact Native Beta handoff in stdin JSON.');
    const operation = input.operation ?? argv[0];
    if (operation === 'preflight') {
      const checkedHandoff = parseHandoff(input.handoff);
      const checkedTarget = parseTarget(input.target, checkedHandoff);
      process.stdout.write(`${toCliJson({ ok: true, protocol: PROTOCOL, profileId: checkedTarget.profileId })}\n`);
      return;
    }
    const adapter = createBetaMonitorAdapter({ handoff: input.handoff, target: input.target, stateStore: createFileStateStore(input.statePath) });
    await adapter.connect();
    let output;
    try {
      switch (operation) {
        case 'connect': output = await adapter.connect(); break;
        case 'readHistory': output = await adapter.readHistory(input.options ?? {}); break;
        case 'readOriginal': output = await adapter.readOriginal(input.originalId, input.options ?? {}); break;
        case 'wait': output = await adapter.wait(input.options ?? {}); break;
        case 'sendAgentNote': output = await adapter.sendAgentNote(input.command); break;
        default: fail('unknown_operation', 'Choose connect, readHistory, readOriginal, wait or sendAgentNote.');
      }
    } finally { await adapter.stop(); }
    process.stdout.write(`${toCliJson(output)}\n`);
  } catch (error) {
    const code = error instanceof BetaMonitorError ? error.code : 'adapter_failed';
    const message = error instanceof BetaMonitorError ? error.message : 'The Beta monitor adapter failed.';
    process.stderr.write(`${toCliJson({ error: { code, message } })}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) await main();
