export type UserRangeExportInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type UserRangeSelection = { kind: 'event'; event_id: string } | { kind: 'timeblock'; block_id: string };
export interface UserRangeExportRequest { request_id: string; profile_id: string; selections: UserRangeSelection[] }
export type UserRangeExportPhase = 'saved' | 'cancelled' | 'failed' | 'interrupted';
export type UserRangeExportProgressPhase = 'preparing' | 'awaiting_destination' | 'writing' | 'verifying' | 'cancelling' | 'publishing';
export interface UserRangeExportResult {
  request_id: string; profile_id: string; phase: UserRangeExportPhase;
  content_complete: boolean; partial_output: boolean; included_originals: number; omitted_originals: number;
  archive_byte_length: number | null; archive_sha256: string | null; failure_code: string | null;
}
export interface UserRangeExportStatus {
  request_id: string; profile_id: string;
  phase: UserRangeExportPhase | UserRangeExportProgressPhase;
  result: UserRangeExportResult | null;
}
export interface UserRangeExportClient {
  capabilities(): Promise<{ schema: 1; supported: boolean }>;
  exportRange(request: UserRangeExportRequest): Promise<UserRangeExportResult>;
  status(profileId: string, requestId: string): Promise<UserRangeExportStatus | null>;
  cancel(requestId: string): Promise<{ request_id: string; accepted: boolean }>;
}
type Code = 'invalid_request' | 'invalid_response' | 'native_unavailable' | 'native_failed';
export class UserRangeExportError extends Error {
  constructor(readonly code: Code) {
    super({
      invalid_request: '导出选择无效，尚未发起导出。',
      invalid_response: '导出回执与本次选择不一致，文件结果尚未确认。',
      native_unavailable: '当前客户端尚不支持选取内容导出。',
      native_failed: '导出结果未确认，请先核对任务与目的文件，不要重复提交。',
    }[code]);
    this.name = 'UserRangeExportError';
  }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
function fail(code: Code): never { throw new UserRangeExportError(code); }
function id(value: unknown, code: Code): string {
  if (typeof value !== 'string' || !UUID.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) fail(code);
  return value.toLowerCase();
}
function record(value: unknown, keys: string[], code: Code): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code);
  return value as Record<string, unknown>;
}
function validateRequest(input: UserRangeExportRequest): UserRangeExportRequest {
  const raw = record(input, ['request_id', 'profile_id', 'selections'], 'invalid_request');
  if (!Array.isArray(raw.selections) || raw.selections.length === 0 || raw.selections.length > 512) fail('invalid_request');
  const selections = raw.selections.map((value): UserRangeSelection => {
    if (!value || typeof value !== 'object') fail('invalid_request');
    if (value.kind === 'event') {
      const item = record(value, ['kind', 'event_id'], 'invalid_request');
      return { kind: 'event', event_id: id(item.event_id, 'invalid_request') };
    }
    const item = record(value, ['kind', 'block_id'], 'invalid_request');
    if (item.kind !== 'timeblock') fail('invalid_request');
    return { kind: 'timeblock', block_id: id(item.block_id, 'invalid_request') };
  });
  const keys = selections.map(item => item.kind === 'event' ? `event:${item.event_id}` : `timeblock:${item.block_id}`);
  if (new Set(keys).size !== keys.length) fail('invalid_request');
  return { request_id: id(raw.request_id, 'invalid_request'), profile_id: id(raw.profile_id, 'invalid_request'), selections };
}
function result(value: unknown, profileId: string, requestId: string): UserRangeExportResult {
  const raw = record(value, ['request_id', 'profile_id', 'phase', 'content_complete', 'partial_output', 'included_originals', 'omitted_originals', 'archive_byte_length', 'archive_sha256', 'failure_code'], 'invalid_response');
  if (id(raw.request_id, 'invalid_response') !== requestId || id(raw.profile_id, 'invalid_response') !== profileId
    || typeof raw.phase !== 'string' || !['saved', 'cancelled', 'failed', 'interrupted'].includes(raw.phase)
    || typeof raw.content_complete !== 'boolean' || typeof raw.partial_output !== 'boolean'
    || !Number.isSafeInteger(raw.included_originals) || Number(raw.included_originals) < 0
    || !Number.isSafeInteger(raw.omitted_originals) || Number(raw.omitted_originals) < 0) fail('invalid_response');
  const bytes = raw.archive_byte_length ?? null, hash = raw.archive_sha256 ?? null, failure = raw.failure_code ?? null;
  if (raw.phase === 'saved') {
    if (!Number.isSafeInteger(bytes) || Number(bytes) <= 0 || typeof hash !== 'string' || !SHA.test(hash) || failure !== null) fail('invalid_response');
  } else if (bytes !== null || hash !== null) fail('invalid_response');
  if (failure !== null && (typeof failure !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(failure))) fail('invalid_response');
  return {
    request_id: requestId, profile_id: profileId, phase: raw.phase as UserRangeExportPhase,
    content_complete: raw.content_complete, partial_output: raw.partial_output,
    included_originals: raw.included_originals as number, omitted_originals: raw.omitted_originals as number,
    archive_byte_length: bytes as number | null, archive_sha256: hash as string | null, failure_code: failure as string | null,
  };
}
function statusResult(value: unknown, profileId: string, requestId: string): UserRangeExportStatus {
  const raw = record(value, ['request_id', 'profile_id', 'phase', 'result'], 'invalid_response');
  if (id(raw.request_id, 'invalid_response') !== requestId || id(raw.profile_id, 'invalid_response') !== profileId || typeof raw.phase !== 'string') fail('invalid_response');
  const terminal = ['saved', 'cancelled', 'failed', 'interrupted'].includes(raw.phase);
  if (!terminal && !['preparing', 'awaiting_destination', 'writing', 'verifying', 'cancelling', 'publishing'].includes(raw.phase)) fail('invalid_response');
  const completion = raw.result === null || raw.result === undefined ? null : result(raw.result, profileId, requestId);
  if ((terminal && (!completion || completion.phase !== raw.phase)) || (!terminal && completion)) fail('invalid_response');
  return { request_id: requestId, profile_id: profileId, phase: raw.phase as UserRangeExportStatus['phase'], result: completion };
}
export function createUserRangeExportClient(invoke: UserRangeExportInvoke | null): UserRangeExportClient {
  async function call(command: string, args?: Record<string, unknown>) {
    if (!invoke) fail('native_unavailable');
    try { return await invoke(command, args); }
    catch (error) {
      const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      fail(/(?:unknown command|command .+ not found)/i.test(text) ? 'native_unavailable' : 'native_failed');
    }
  }
  return {
    async capabilities() {
      const raw = record(await call('beta_user_range_export_capabilities'), ['schema', 'supported'], 'invalid_response');
      if (raw.schema !== 1 || typeof raw.supported !== 'boolean') fail('invalid_response');
      return { schema: 1, supported: raw.supported };
    },
    async exportRange(input) {
      const request = validateRequest(input);
      return result(await call('beta_export_user_range', { request }), request.profile_id, request.request_id);
    },
    async status(profileId, requestId) {
      const profile = id(profileId, 'invalid_request'), request = id(requestId, 'invalid_request');
      const raw = await call('beta_user_range_export_status', { requestId: request });
      return raw === null ? null : statusResult(raw, profile, request);
    },
    async cancel(requestId) {
      const request = id(requestId, 'invalid_request');
      const raw = record(await call('beta_cancel_user_range_export', { requestId: request }), ['request_id', 'accepted'], 'invalid_response');
      if (id(raw.request_id, 'invalid_response') !== request || typeof raw.accepted !== 'boolean') fail('invalid_response');
      return { request_id: request, accepted: raw.accepted };
    },
  };
}
