import { BetaApiError } from './api-error';

export type BetaOriginalExportResult =
  | { cancelled: true; partial_output?: boolean }
  | { cancelled: false; byte_length: number; sha256: string };

export type BetaOriginalExportHistoryPhase =
  | 'preparing'
  | 'awaiting_destination'
  | 'writing'
  | 'verifying'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'interrupted';

export interface BetaOriginalExportHistoryEntry {
  request_id: string;
  profile_id: string;
  original_id: string;
  file_name: string;
  byte_length: number;
  sha256: string;
  phase: BetaOriginalExportHistoryPhase;
  failure_code: string | null;
  partial_output: boolean;
}

export interface BetaOriginalExportsClient {
  history?(profileId: string): Promise<BetaOriginalExportHistoryEntry[]>;
  save(profileId: string, originalId: string, requestId: string): Promise<BetaOriginalExportResult>;
  cancel(requestId: string): Promise<boolean>;
}
type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
function invalid(): never { throw new BetaApiError('invalid_export_response', '导出结果尚未确认，请检查所选保存位置'); }
function invalidHistory(): never { throw new BetaApiError('invalid_export_response', '原生导出历史无效，现有任务保持不变'); }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const HISTORY_PHASES: readonly BetaOriginalExportHistoryPhase[] = [
  'preparing', 'awaiting_destination', 'writing', 'verifying',
  'succeeded', 'cancelled', 'failed', 'interrupted',
];
const ACTIVE_PHASES = new Set<BetaOriginalExportHistoryPhase>([
  'preparing', 'awaiting_destination', 'writing', 'verifying',
]);
const HISTORY_FIELDS = new Set([
  'request_id', 'profile_id', 'original_id', 'file_name', 'byte_length',
  'sha256', 'phase', 'failure_code', 'partial_output',
]);
const MAX_HISTORY_ENTRIES = 33;
const MAX_TERMINAL_HISTORY_ENTRIES = 32;
const MAX_FILE_NAME_BYTES = 4096;
const MAX_FAILURE_CODE_BYTES = 128;

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value) && value.toLowerCase() !== NIL_UUID;
}

function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (length > MAX_FILE_NAME_BYTES) return length;
  }
  return length;
}

function validFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FILE_NAME_BYTES
    && !value.includes('\0') && utf8Length(value) <= MAX_FILE_NAME_BYTES;
}

function validFailureCode(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FAILURE_CODE_BYTES
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validPhaseFields(
  phase: BetaOriginalExportHistoryPhase,
  failureCode: string | null,
  partialOutput: boolean,
): boolean {
  switch (phase) {
    case 'preparing':
    case 'awaiting_destination':
      return failureCode === null && !partialOutput;
    case 'writing':
    case 'verifying':
      return failureCode === null && partialOutput;
    case 'succeeded':
      return failureCode === null && !partialOutput;
    case 'cancelled':
    case 'failed':
    case 'interrupted':
      return failureCode !== null;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function history(value: unknown, profileId: string): BetaOriginalExportHistoryEntry[] {
  if (!validUuid(profileId) || !Array.isArray(value) || value.length > MAX_HISTORY_ENTRIES) return invalidHistory();
  const requestIds = new Set<string>();
  let activeCount = 0;
  let terminalCount = 0;
  const entries: BetaOriginalExportHistoryEntry[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalidHistory();
    const raw = item as Record<string, unknown>;
    const fields = Object.keys(raw);
    if (fields.length !== HISTORY_FIELDS.size || fields.some(field => !HISTORY_FIELDS.has(field))) return invalidHistory();

    if (!validUuid(raw.request_id)
      || !validUuid(raw.profile_id) || raw.profile_id !== profileId
      || !validUuid(raw.original_id)
      || !validFileName(raw.file_name)
      || !Number.isSafeInteger(raw.byte_length) || Number(raw.byte_length) < 0
      || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)
      || typeof raw.phase !== 'string' || !HISTORY_PHASES.includes(raw.phase as BetaOriginalExportHistoryPhase)
      || typeof raw.partial_output !== 'boolean'
      || !(raw.failure_code === null || validFailureCode(raw.failure_code))
      || requestIds.has(raw.request_id)) return invalidHistory();

    const phase = raw.phase as BetaOriginalExportHistoryPhase;
    const failureCode = raw.failure_code as string | null;
    const partialOutput = raw.partial_output as boolean;
    if (!validPhaseFields(phase, failureCode, partialOutput)) return invalidHistory();
    if (ACTIVE_PHASES.has(phase)) activeCount += 1;
    else terminalCount += 1;
    if (activeCount > 1 || terminalCount > MAX_TERMINAL_HISTORY_ENTRIES) return invalidHistory();
    requestIds.add(raw.request_id);
    entries.push({
      request_id: raw.request_id,
      profile_id: raw.profile_id,
      original_id: raw.original_id,
      file_name: raw.file_name,
      byte_length: Number(raw.byte_length),
      sha256: raw.sha256,
      phase,
      failure_code: failureCode,
      partial_output: partialOutput,
    });
  }
  return entries;
}

export function nativeOriginalExports(call: Call): BetaOriginalExportsClient {
  return {
    async history(profileId) {
      const value: unknown = await call('beta_original_export_history', { profileId });
      return history(value, profileId);
    },
    async save(profileId, originalId, requestId) {
      const value: unknown = await call('beta_export_original', { profileId, originalId, requestId });
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
      const raw = value as Record<string, unknown>;
      if (raw.cancelled === true) {
        if (Object.keys(raw).some(key => key !== 'cancelled' && key !== 'partial_output')
            || raw.partial_output !== undefined && typeof raw.partial_output !== 'boolean') return invalid();
        return { cancelled: true, ...(raw.partial_output === undefined ? {} : { partial_output: raw.partial_output as boolean }) };
      }
      if (raw.cancelled !== false || Object.keys(raw).some(key => !['cancelled','byte_length','sha256'].includes(key))
          || !Number.isSafeInteger(raw.byte_length) || Number(raw.byte_length) < 0
          || typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return invalid();
      return { cancelled: false, byte_length: Number(raw.byte_length), sha256: raw.sha256 };
    },
    async cancel(requestId) {
      const value: unknown = await call('beta_cancel_original_export', { requestId });
      if (typeof value !== 'boolean') return invalid();
      return value;
    },
  };
}
