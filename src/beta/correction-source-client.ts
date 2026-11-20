import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';
import type { BetaStatus } from './client';
import { MAX_BETA_CORRECTION_TEXT_BYTES, type BetaCorrectionEntry } from './record-organization-client';
import { summaryUuid } from './summary-validation';

type NativeCall = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type CorrectionSourceReader = (profileId: string, eventId: string, digest: string) => Promise<BetaCorrectionEntry | null>;

const messages: Record<string, string> = {
  source_service_changed: '本机服务已变化，请重新连接后查看更正来源',
  invalid_correction_source: '更正来源响应与引用不一致，未呈现更正正文',
  unsupported_correction_source: '当前服务未声明精确更正来源读取能力，请更新到同版 Beta',
  forbidden: '当前授权不能查看这条更正来源',
  unauthorized: '当前授权已失效，请重新连接',
  recovery_required: '来源资料需要恢复，现有记录已保留',
  storage_error: '本机存储暂不能读取来源，请稍后重试',
  stopped: '本机服务已停止',
  correction_source_unavailable: '更正来源暂不能读取，请稍后重试',
};

function invalid(): never {
  throw new BetaApiError('invalid_correction_source', messages.invalid_correction_source);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) return invalid();
  return raw;
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalid();
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid();
    } else if (code >= 0xdc00 && code <= 0xdfff) return invalid();
  }
  if (new TextEncoder().encode(value).byteLength > MAX_BETA_CORRECTION_TEXT_BYTES) return invalid();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}

function integer(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return invalid();
  return value;
}

/** Strictly validate an exact correction response against the summary source ref. */
export function validateCorrectionSourceEntry(
  value: unknown,
  profileId: string,
  eventId: string,
  expectedDigest: string,
): BetaCorrectionEntry | null {
  try {
    const profile = summaryUuid(profileId);
    const event = summaryUuid(eventId);
    const digest = hash(expectedDigest);
    if (value === null) return null;
    const raw = exactObject(value, ['record', 'target_state']);
    const record = exactObject(raw.record, [
      'event_id', 'profile_id', 'device_id', 'author_id', 'author_kind', 'occurred_at_ms',
      'target_event_id', 'target_digest', 'corrected_text', 'digest', 'local_seq',
    ]);
    const result: BetaCorrectionEntry = {
      record: {
        event_id: summaryUuid(record.event_id),
        profile_id: summaryUuid(record.profile_id),
        device_id: summaryUuid(record.device_id),
        author_id: summaryUuid(record.author_id),
        author_kind: 'human',
        occurred_at_ms: integer(record.occurred_at_ms, 0),
        target_event_id: summaryUuid(record.target_event_id),
        target_digest: hash(record.target_digest),
        corrected_text: boundedText(record.corrected_text),
        digest: hash(record.digest),
        local_seq: integer(record.local_seq, 1),
      },
      target_state: raw.target_state as BetaCorrectionEntry['target_state'],
    };
    if (raw.target_state !== 'unresolved' && raw.target_state !== 'digest_matches' && raw.target_state !== 'digest_conflict'
      || result.record.profile_id !== profile || result.record.event_id !== event || result.record.digest !== digest
      || result.record.target_event_id === event || record.author_kind !== 'human'
    ) {
      return invalid();
    }
    return result;
  } catch {
    return invalid();
  }
}

function reader(
  identity: () => Promise<BetaStatus>,
  read: (profileId: string, eventId: string) => Promise<unknown>,
): CorrectionSourceReader {
  let bound: { runtimeId: string; deviceId: string } | null = null;
  let invalidated = false;

  async function checkIdentity(): Promise<{ runtimeId: string; deviceId: string }> {
    const state = await identity();
    if (state.protocol !== 'exomind-beta/1' || state.running !== true) {
      invalidated = true;
      throw new BetaApiError('source_service_changed', messages.source_service_changed);
    }
    const deviceId = summaryUuid(state.device_id);
    const runtimeId = summaryUuid(state.runtime_id);
    if (invalidated || bound && (bound.deviceId !== deviceId || bound.runtimeId !== runtimeId)) {
      invalidated = true;
      throw new BetaApiError('source_service_changed', messages.source_service_changed);
    }
    if (state.capabilities?.correction_source !== true) {
      throw new BetaApiError('unsupported_correction_source', messages.unsupported_correction_source);
    }
    bound = { runtimeId, deviceId };
    return bound;
  }

  return async (profileId, eventId, digest) => {
    try {
      summaryUuid(profileId);
      summaryUuid(eventId);
      hash(digest);
      const before = await checkIdentity();
      const value = await read(profileId, eventId);
      const after = await checkIdentity();
      if (before.deviceId !== after.deviceId || before.runtimeId !== after.runtimeId) {
        throw new BetaApiError('source_service_changed', messages.source_service_changed);
      }
      return validateCorrectionSourceEntry(value, profileId, eventId, digest);
    } catch (error) {
      const raw = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : '';
      const code = Object.prototype.hasOwnProperty.call(messages, raw) ? raw : 'correction_source_unavailable';
      throw new BetaApiError(code, messages[code]);
    }
  };
}

export function nativeCorrectionSourceReader(
  call: NativeCall = invoke,
  identity: () => Promise<BetaStatus> = () => call<BetaStatus>('beta_status'),
): CorrectionSourceReader {
  return reader(identity, (profileId, eventId) => call('beta_correction_event', { profileId, eventId }));
}

export function webCorrectionSourceReader(io: {
  identity(): Promise<BetaStatus>;
  json(profileId: string, path: string): Promise<unknown>;
}): CorrectionSourceReader {
  return reader(
    () => io.identity(),
    (profileId, eventId) => io.json(
      profileId,
      `/profiles/${encodeURIComponent(profileId)}/corrections/${encodeURIComponent(eventId)}`,
    ),
  );
}
