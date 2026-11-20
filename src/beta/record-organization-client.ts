import { BetaApiError } from './api-error';
import type { BetaPage, BetaQuery, BetaReceipt } from './client';

export const MAX_BETA_EVENT_TAGS = 64;
export const MAX_BETA_EVENT_TAG_BYTES = 128;
/** Mirrors Core's MAX_CORRECTION_TEXT_BYTES; keep the UI and adapter bounded before persistence or RPC. */
export const MAX_BETA_CORRECTION_TEXT_BYTES = 128 * 1024;

export interface BetaRecordCorrectionCommand {
  command_id: string;
  event_id: string;
  profile_id: string;
  occurred_at_ms: number;
  target_event_id: string;
  target_digest: string;
  corrected_text: string;
}

export type BetaCorrectionTargetState = 'unresolved' | 'digest_matches' | 'digest_conflict';

export interface BetaCorrectionEntry {
  record: {
    event_id: string;
    profile_id: string;
    device_id: string;
    author_id: string;
    author_kind: 'human';
    occurred_at_ms: number;
    target_event_id: string;
    target_digest: string;
    corrected_text: string;
    digest: string;
    local_seq: number;
  };
  target_state: BetaCorrectionTargetState;
}

export interface BetaCorrectionPage {
  items: BetaCorrectionEntry[];
  next_before: number | null;
  highwater: number;
}

export interface BetaRecordOrganizationClient {
  eventsPageWithTag(profileId: string, query: BetaQuery, tag: string): Promise<BetaPage>;
  correctionsForTarget(profileId: string, targetEventId: string, query: BetaQuery): Promise<BetaCorrectionPage>;
  recordCorrection(command: BetaRecordCorrectionCommand): Promise<BetaReceipt>;
}

type NativeCall = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;

export interface BetaRecordOrganizationIO {
  json(profileId: string, path: string, method: string, body?: unknown): Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BetaApiError('invalid_response', '记录服务返回了无法识别的数据');
  }
  return value as Record<string, unknown>;
}

function boundedQuery(query: BetaQuery): void {
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)) {
    throw new BetaApiError('invalid_query', '记录页大小无效');
  }
  if (query.before !== undefined && (!Number.isSafeInteger(query.before) || query.before < 1)) {
    throw new BetaApiError('invalid_query', '记录位置无效');
  }
  if (query.through !== undefined && (!Number.isSafeInteger(query.through) || query.through < 0)) {
    throw new BetaApiError('invalid_query', '记录快照无效');
  }
}

function validateCapturePage(value: unknown, profileId: string, query: BetaQuery): BetaPage {
  const item = object(value);
  if (!Array.isArray(item.items) || !Number.isSafeInteger(item.highwater) || Number(item.highwater) < 0
    || (query.through !== undefined && item.highwater !== query.through)) {
    throw new BetaApiError('invalid_page', '记录快照不一致，请重新加载');
  }
  let previous = query.before ?? Number.MAX_SAFE_INTEGER;
  for (const raw of item.items) {
    const event = object(raw);
    if (event.profile_id !== profileId || typeof event.event_id !== 'string' || typeof event.text !== 'string'
      || !Number.isSafeInteger(event.local_seq) || Number(event.local_seq) <= 0 || Number(event.local_seq) >= previous
      || Number(event.local_seq) > Number(item.highwater) || !Number.isSafeInteger(event.occurred_at_ms)
      || (event.author_kind !== 'human' && event.author_kind !== 'agent_note')
      || !Array.isArray(event.tags) || !event.tags.every(tag => typeof tag === 'string')) {
      throw new BetaApiError('invalid_page', '标签筛选结果包含不一致的记录');
    }
    previous = Number(event.local_seq);
  }
  if (item.items.length > (query.limit ?? 100) || (item.next_before !== null
    && (!item.items.length || item.next_before !== previous))) {
    throw new BetaApiError('invalid_page', '标签筛选位置无效');
  }
  return item as unknown as BetaPage;
}

function validateCorrectionPage(
  value: unknown,
  profileId: string,
  targetEventId: string,
  query: BetaQuery,
): BetaCorrectionPage {
  const item = object(value);
  if (!Array.isArray(item.items) || !Number.isSafeInteger(item.highwater) || Number(item.highwater) < 0
    || (query.through !== undefined && item.highwater !== query.through)
    || (item.next_before !== null && (!Number.isSafeInteger(item.next_before) || Number(item.next_before) <= 0))) {
    throw new BetaApiError('invalid_page', '更正记录快照不一致，请重新加载');
  }
  let previous = query.before ?? Number.MAX_SAFE_INTEGER;
  const entries = item.items.map((raw): BetaCorrectionEntry => {
    const entry = object(raw);
    const record = object(entry.record);
    if (entry.target_state !== 'unresolved' && entry.target_state !== 'digest_matches' && entry.target_state !== 'digest_conflict'
      || record.profile_id !== profileId || record.target_event_id !== targetEventId
      || typeof record.event_id !== 'string' || typeof record.device_id !== 'string' || typeof record.author_id !== 'string'
      || record.author_kind !== 'human' || typeof record.corrected_text !== 'string'
      || !Number.isSafeInteger(record.occurred_at_ms) || !Number.isSafeInteger(record.local_seq)
      || Number(record.local_seq) <= 0 || Number(record.local_seq) >= previous
      || Number(record.local_seq) > Number(item.highwater)
      || typeof record.target_digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.target_digest)
      || typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest)) {
      throw new BetaApiError('invalid_page', '更正记录与当前消息不匹配');
    }
    previous = Number(record.local_seq);
    return entry as unknown as BetaCorrectionEntry;
  });
  if (entries.length > (query.limit ?? 100) || (item.next_before !== null
    && (!entries.length || item.next_before !== previous))) {
    throw new BetaApiError('invalid_page', '更正记录位置无效');
  }
  return { items: entries, next_before: item.next_before as number | null, highwater: Number(item.highwater) };
}

function validateCorrectionReceipt(value: unknown, command: BetaRecordCorrectionCommand): BetaReceipt {
  const item = object(value);
  if (item.command_id !== command.command_id || item.event_id !== command.event_id || item.profile_id !== command.profile_id
    || item.durability !== 'local_committed' || !Number.isSafeInteger(item.local_seq) || Number(item.local_seq) <= 0
    || typeof item.event_digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.event_digest)
    || typeof item.replayed !== 'boolean') {
    throw new BetaApiError('invalid_receipt', '更正回执与本次操作不一致，结果仍待查证');
  }
  return item as unknown as BetaReceipt;
}

function validateCorrectionCommand(command: BetaRecordCorrectionCommand): void {
  if (!command.command_id || !command.event_id || !command.profile_id || !command.target_event_id
    || command.event_id === command.target_event_id || !Number.isSafeInteger(command.occurred_at_ms) || command.occurred_at_ms < 0
    || !/^[a-f0-9]{64}$/.test(command.target_digest) || !command.corrected_text.trim()
    || new TextEncoder().encode(command.corrected_text).byteLength > MAX_BETA_CORRECTION_TEXT_BYTES) {
    throw new BetaApiError('invalid_correction', '更正内容或目标标识超出当前服务的保存范围');
  }
}

function queryParams(query: BetaQuery): URLSearchParams {
  boundedQuery(query);
  const params = new URLSearchParams();
  for (const key of ['before', 'through', 'limit'] as const) {
    if (query[key] !== undefined) params.set(key, String(query[key]));
  }
  if (query.search !== undefined) params.set('q', query.search);
  return params;
}

export function nativeRecordOrganizationClient(call: NativeCall): BetaRecordOrganizationClient {
  return {
    async eventsPageWithTag(profileId, query, tag) {
      boundedQuery(query);
      if (!tag.trim() || new TextEncoder().encode(tag).byteLength > MAX_BETA_EVENT_TAG_BYTES) {
        throw new BetaApiError('invalid_query', '请输入有效标签');
      }
      return validateCapturePage(await call('beta_events_page_with_tag', { profileId, query, tag }), profileId, query);
    },
    async correctionsForTarget(profileId, targetEventId, query) {
      boundedQuery(query);
      return validateCorrectionPage(
        await call('beta_corrections_page', { profileId, query, targetEventId }),
        profileId,
        targetEventId,
        query,
      );
    },
    async recordCorrection(command) {
      validateCorrectionCommand(command);
      return validateCorrectionReceipt(await call('beta_record_correction', { command }), command);
    },
  };
}

export function webRecordOrganizationClient(io: BetaRecordOrganizationIO): BetaRecordOrganizationClient {
  const profilePath = (profileId: string) => `/profiles/${encodeURIComponent(profileId)}`;
  return {
    async eventsPageWithTag(profileId, query, tag) {
      boundedQuery(query);
      if (!tag.trim() || new TextEncoder().encode(tag).byteLength > MAX_BETA_EVENT_TAG_BYTES) {
        throw new BetaApiError('invalid_query', '请输入有效标签');
      }
      const params = queryParams(query);
      params.set('tag', tag);
      return validateCapturePage(
        await io.json(profileId, `${profilePath(profileId)}/events?${params}`, 'GET'),
        profileId,
        query,
      );
    },
    async correctionsForTarget(profileId, targetEventId, query) {
      const params = queryParams(query);
      params.set('target_event_id', targetEventId);
      return validateCorrectionPage(
        await io.json(profileId, `${profilePath(profileId)}/corrections?${params}`, 'GET'),
        profileId,
        targetEventId,
        query,
      );
    },
    async recordCorrection(command) {
      validateCorrectionCommand(command);
      const { profile_id, command_id, event_id, occurred_at_ms, target_event_id, target_digest, corrected_text } = command;
      return validateCorrectionReceipt(await io.json(profile_id, `${profilePath(profile_id)}/corrections`, 'POST', {
        command_id, event_id, occurred_at_ms, target_event_id, target_digest, corrected_text,
      }), command);
    },
  };
}
