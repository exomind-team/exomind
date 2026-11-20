export type ProfileArchiveInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export type ProfileArchiveDirection = 'import' | 'export';
export const PROFILE_ARCHIVE_PHASES = [
  'preparing', 'awaiting_source', 'spooling', 'preview_ready', 'importing', 'exporting',
  'awaiting_destination', 'writing', 'verifying', 'cancel_requested', 'succeeded',
  'cancelled', 'failed', 'interrupted',
] as const;
export type ProfileArchivePhase = typeof PROFILE_ARCHIVE_PHASES[number];
export interface ProfileArchiveCapabilities { schema: 1; supports_import: boolean; supports_export: boolean }
export interface ProfileArchiveAck { request_id: string; accepted: true }
export interface ProfileArchivePreview {
  request_id: string; profile_id: string; source_display_name?: string; archive_sha256: string;
  fact_count: number; original_count: number; conflict_count: number; missing_original_count: number;
  unverified_origin_count: number; facts_complete: boolean; proofs_complete: boolean;
  bytes_complete: boolean; target_bytes_complete: boolean; can_import: boolean;
}
export interface ProfileArchiveTask {
  request_id: string; profile_id?: string; direction: ProfileArchiveDirection; phase: ProfileArchivePhase;
  archive_sha256?: string; archive_complete?: boolean; byte_length?: number;
  bytes_processed: number; facts_processed: number; original_bytes_processed: number;
  failure_code?: string; partial_output: boolean; preview?: ProfileArchivePreview;
}
export interface ProfileArchiveClient {
  capabilities(): Promise<ProfileArchiveCapabilities>;
  history(profileId?: string): Promise<ProfileArchiveTask[]>;
  previewImport(requestId: string, expectedProfileId?: string): Promise<ProfileArchiveAck>;
  confirmImport(requestId: string): Promise<ProfileArchiveAck>;
  exportProfile(profileId: string, requestId: string): Promise<ProfileArchiveAck>;
  cancel(requestId: string): Promise<boolean>;
}
type ErrorCode = 'invalid_request' | 'invalid_response' | 'native_unavailable' | 'native_failed';
export class ProfileArchiveClientError extends Error {
  constructor(readonly code: ErrorCode) {
    super({
      invalid_request: '档案操作的身份无效，尚未发起操作。',
      invalid_response: '档案操作返回的信息不完整或不匹配，请刷新操作历史核对结果。',
      native_unavailable: '当前客户端尚不支持档案往返，请使用支持此功能的外心客户端。',
      native_failed: '未能确认档案操作结果，请刷新操作历史查证后再决定下一步。',
    }[code]);
    this.name = 'ProfileArchiveClientError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
function invalid(): never { throw new ProfileArchiveClientError('invalid_response'); }
function uuid(value: unknown, response = true): string {
  if (typeof value !== 'string' || !UUID.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) {
    throw new ProfileArchiveClientError(response ? 'invalid_response' : 'invalid_request');
  }
  return value.toLowerCase();
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return value as number;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function sha(value: unknown): string { if (typeof value !== 'string' || !SHA.test(value)) invalid(); return value; }
function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === null || value === undefined ? undefined : parse(value);
}
function preview(value: unknown, requestId: string, profileId?: string): ProfileArchivePreview {
  const raw = object(value, [
    'request_id', 'profile_id', 'source_display_name', 'archive_sha256', 'fact_count', 'original_count',
    'conflict_count', 'missing_original_count', 'unverified_origin_count', 'facts_complete',
    'proofs_complete', 'bytes_complete', 'target_bytes_complete', 'can_import',
  ]);
  const id = uuid(raw.profile_id);
  if (uuid(raw.request_id) !== requestId || !profileId || id !== profileId) invalid();
  const displayName = optional(raw.source_display_name, value => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) invalid();
    return value;
  });
  const parsed: ProfileArchivePreview = {
    request_id: requestId, profile_id: id, archive_sha256: sha(raw.archive_sha256),
    fact_count: count(raw.fact_count), original_count: count(raw.original_count),
    conflict_count: count(raw.conflict_count), missing_original_count: count(raw.missing_original_count),
    unverified_origin_count: count(raw.unverified_origin_count), facts_complete: boolean(raw.facts_complete),
    proofs_complete: boolean(raw.proofs_complete), bytes_complete: boolean(raw.bytes_complete),
    target_bytes_complete: boolean(raw.target_bytes_complete), can_import: boolean(raw.can_import),
  };
  if (parsed.can_import && parsed.conflict_count !== 0) invalid();
  if (displayName !== undefined) parsed.source_display_name = displayName;
  return parsed;
}
function task(value: unknown, filter?: string): ProfileArchiveTask {
  const raw = object(value, [
    'request_id', 'profile_id', 'direction', 'phase', 'archive_sha256', 'archive_complete', 'byte_length',
    'bytes_processed', 'facts_processed', 'original_bytes_processed', 'failure_code', 'partial_output', 'preview',
  ]);
  const requestId = uuid(raw.request_id);
  const profileId = optional(raw.profile_id, value => uuid(value));
  if ((filter && profileId !== filter) || !['import', 'export'].includes(String(raw.direction))
    || !(PROFILE_ARCHIVE_PHASES as readonly unknown[]).includes(raw.phase)) invalid();
  const failureCode = optional(raw.failure_code, value => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) invalid();
    return value;
  });
  const parsed: ProfileArchiveTask = {
    request_id: requestId, direction: raw.direction as ProfileArchiveDirection, phase: raw.phase as ProfileArchivePhase,
    bytes_processed: count(raw.bytes_processed), facts_processed: count(raw.facts_processed),
    original_bytes_processed: count(raw.original_bytes_processed), partial_output: boolean(raw.partial_output),
  };
  if (profileId !== undefined) parsed.profile_id = profileId;
  const archiveSha = optional(raw.archive_sha256, sha);
  const complete = optional(raw.archive_complete, boolean);
  const byteLength = optional(raw.byte_length, count);
  if (archiveSha !== undefined) parsed.archive_sha256 = archiveSha;
  if (complete !== undefined) parsed.archive_complete = complete;
  if (byteLength !== undefined) parsed.byte_length = byteLength;
  if (failureCode !== undefined) parsed.failure_code = failureCode;
  if (raw.preview !== null && raw.preview !== undefined) {
    parsed.preview = preview(raw.preview, requestId, profileId);
    if (parsed.direction !== 'import' || (archiveSha && parsed.preview.archive_sha256 !== archiveSha)) invalid();
  }
  if (parsed.phase === 'preview_ready' && !parsed.preview) invalid();
  return parsed;
}

export function createProfileArchiveClient(invoke: ProfileArchiveInvoke | null): ProfileArchiveClient {
  async function call(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!invoke) throw new ProfileArchiveClientError('native_unavailable');
    try { return await invoke(command, args); }
    catch (error) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      throw new ProfileArchiveClientError(/(?:unknown command|command .+ not found)/i.test(message) ? 'native_unavailable' : 'native_failed');
    }
  }
  async function ack(command: string, args: Record<string, unknown>, requestId: string): Promise<ProfileArchiveAck> {
    const raw = object(await call(command, args), ['request_id', 'accepted']);
    if (uuid(raw.request_id) !== requestId || raw.accepted !== true) invalid();
    return { request_id: requestId, accepted: true };
  }
  return {
    async capabilities() {
      const raw = object(await call('beta_profile_archive_capabilities'), ['schema', 'supports_import', 'supports_export']);
      if (raw.schema !== 1) invalid();
      return { schema: 1, supports_import: boolean(raw.supports_import), supports_export: boolean(raw.supports_export) };
    },
    async history(profileId) {
      const filter = profileId === undefined ? undefined : uuid(profileId, false);
      const raw = await call('beta_profile_archive_history', { profileId: filter ?? null });
      if (!Array.isArray(raw) || raw.length > 33) invalid();
      const rows = raw.map(value => task(value, filter));
      if (new Set(rows.map(row => row.request_id)).size !== rows.length) invalid();
      return rows;
    },
    async previewImport(requestId, expectedProfileId) {
      const id = uuid(requestId, false);
      const expected = expectedProfileId === undefined ? null : uuid(expectedProfileId, false);
      return ack('beta_profile_archive_import_preview', { requestId: id, expectedProfileId: expected }, id);
    },
    async confirmImport(requestId) {
      const id = uuid(requestId, false);
      return ack('beta_profile_archive_import_confirm', { requestId: id }, id);
    },
    async exportProfile(profileId, requestId) {
      const profile = uuid(profileId, false), id = uuid(requestId, false);
      return ack('beta_profile_archive_export', { profileId: profile, requestId: id }, id);
    },
    async cancel(requestId) {
      return boolean(await call('beta_profile_archive_cancel', { requestId: uuid(requestId, false) }));
    },
  };
}
