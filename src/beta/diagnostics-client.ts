import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';

export const DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
const MAX_ID_LENGTH = 128;
const U64_MAX = 18_446_744_073_709_551_615n;
const DECIMAL_U64 = /^(0|[1-9]\d*)$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DIAGNOSTIC_REASONS = [
  'unsupported',
  'permission_denied',
  'unavailable',
  'invalid_data',
  'initial_sample',
  'identity_changed',
  'counter_regressed',
  'clock_did_not_advance',
  'clock_regressed',
  'budget_exceeded',
  'cancelled',
  'entry_unavailable',
  'invalid_root',
] as const;

export type DiagnosticReason = typeof DIAGNOSTIC_REASONS[number];
export type MetricUnit = 'nanoseconds' | 'bytes' | 'cpu_cores';
export type ProcessMetric<T> =
  | { value: T; unit: MetricUnit; availability: 'available'; reason: null }
  | { value: null; unit: MetricUnit; availability: 'unknown'; reason: DiagnosticReason };

export interface ProcessIdentity {
  pid: number;
  collectorLifecycle: string;
}

export interface ProcessResourceSample {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION;
  scope: 'native_host_process';
  identity: ProcessIdentity;
  sampledAtUnixMs: number | null;
  monotonicElapsedNs: string;
  cpu: {
    cumulativeTime: ProcessMetric<string>;
    usageCores: ProcessMetric<number>;
    measurementWindow: ProcessMetric<string>;
  };
  memory: {
    workingSetBytes: ProcessMetric<number>;
    privateBytes: ProcessMetric<number>;
  };
}

export interface BetaDiagnosticsSample {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION;
  deviceId: string;
  runtimeId: string;
  process: ProcessResourceSample;
}

export type StorageArea =
  | 'host_root'
  | 'core_store'
  | 'native_private_ui'
  | 'local_source_store'
  | 'peer_identity'
  | 'unclassified';

export interface StorageAreaTotals {
  area: StorageArea;
  fileCount: number;
  directoryCount: number;
  logicalBytesCounted: number;
}

export interface StorageScanReport {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION;
  scope: 'native_provided_host_root';
  recursiveWithoutLinks: true;
  status: 'complete' | 'partial';
  partialReasons: DiagnosticReason[];
  startedAtUnixMs: number | null;
  finishedAtUnixMs: number | null;
  elapsedNs: string;
  appliedBudget: {
    maxEntries: number;
    maxFiles: number;
    maxDirectories: number;
    maxLogicalBytes: number;
    maxElapsedMs: number;
  };
  entriesExamined: number;
  directoriesExamined: number;
  filesExamined: number;
  skippedLinkEntries: number;
  skippedSpecialEntries: number;
  logicalBytesCounted: number;
  areas: StorageAreaTotals[];
}

export interface BetaDiagnosticsStorageEnvelope {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION;
  deviceId: string;
  runtimeId: string;
  scanId: string;
  storage: StorageScanReport;
}

export interface BetaDiagnosticsCancellation {
  scanId: string;
  cancellationRequested: boolean;
}

export interface BetaDiagnosticsClient {
  sample(): Promise<BetaDiagnosticsSample>;
  scanStorage(scanId: string): Promise<BetaDiagnosticsStorageEnvelope>;
  cancelStorage(scanId: string): Promise<BetaDiagnosticsCancellation>;
}

export type NativeDiagnosticsInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export class BetaDiagnosticsClientError extends Error {
  constructor(readonly code: 'invalid_response' | 'request_failed') {
    super(code === 'invalid_response'
      ? '本机诊断响应格式无法识别，已忽略本次结果。'
      : '本机诊断请求未确认，请稍后重试。');
    this.name = 'BetaDiagnosticsClientError';
  }
}

interface ClientFactoryOptions {
  invoke?: NativeDiagnosticsInvoke;
  isTauri?: () => boolean;
}

const AREAS: readonly StorageArea[] = [
  'host_root',
  'core_store',
  'native_private_ui',
  'local_source_store',
  'peer_identity',
  'unclassified',
];

function invalidResponse(): never {
  throw new BetaDiagnosticsClientError('invalid_response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(record, key));
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isUnixMilliseconds(value: unknown): value is number | null {
  return value === null || isSafeCount(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && SAFE_IDENTIFIER.test(value);
}

function isReason(value: unknown): value is DiagnosticReason {
  return typeof value === 'string' && (DIAGNOSTIC_REASONS as readonly string[]).includes(value);
}

function isDecimalU64(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_U64.test(value)) return false;
  try {
    return BigInt(value) <= U64_MAX;
  } catch {
    return false;
  }
}

function metric<T>(
  value: unknown,
  expectedUnit: MetricUnit,
  readValue: (candidate: unknown) => candidate is T,
): ProcessMetric<T> {
  if (!isRecord(value) || !hasExactKeys(value, ['value', 'unit', 'availability', 'reason']) || value.unit !== expectedUnit) {
    return invalidResponse();
  }
  const candidate = value.value;
  const availability = value.availability;
  const reason = value.reason;
  if (availability === 'available' && reason === null && readValue(candidate)) {
    return { value: candidate, unit: expectedUnit, availability: 'available', reason: null };
  }
  if (availability === 'unknown' && candidate === null && isReason(reason)) {
    return { value: null, unit: expectedUnit, availability: 'unknown', reason };
  }
  return invalidResponse();
}

function readU64String(value: unknown): value is string {
  return isDecimalU64(value);
}

function readCpuCores(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readByteCount(value: unknown): value is number {
  return isSafeCount(value);
}

function parseProcessResourceSample(value: unknown): ProcessResourceSample {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'scope', 'identity', 'sampledAtUnixMs', 'monotonicElapsedNs', 'cpu', 'memory',
  ])) return invalidResponse();
  if (value.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION || value.scope !== 'native_host_process') return invalidResponse();
  if (!isRecord(value.identity) || !hasExactKeys(value.identity, ['pid', 'collectorLifecycle'])) return invalidResponse();
  if (!isSafeCount(value.identity.pid) || value.identity.pid < 1 || value.identity.pid > 4_294_967_295) return invalidResponse();
  if (typeof value.identity.collectorLifecycle !== 'string' || !UUID.test(value.identity.collectorLifecycle)) return invalidResponse();
  if (!isUnixMilliseconds(value.sampledAtUnixMs) || !isDecimalU64(value.monotonicElapsedNs)) return invalidResponse();
  if (!isRecord(value.cpu) || !hasExactKeys(value.cpu, ['cumulativeTime', 'usageCores', 'measurementWindow'])) return invalidResponse();
  if (!isRecord(value.memory) || !hasExactKeys(value.memory, ['workingSetBytes', 'privateBytes'])) return invalidResponse();

  const cumulativeTime = metric(value.cpu.cumulativeTime, 'nanoseconds', readU64String);
  const usageCores = metric(value.cpu.usageCores, 'cpu_cores', readCpuCores);
  const measurementWindow = metric(value.cpu.measurementWindow, 'nanoseconds', readU64String);
  if (usageCores.availability !== measurementWindow.availability
    || (usageCores.availability === 'unknown' && measurementWindow.availability === 'unknown'
      && usageCores.reason !== measurementWindow.reason)) return invalidResponse();

  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    scope: 'native_host_process',
    identity: {
      pid: value.identity.pid,
      collectorLifecycle: value.identity.collectorLifecycle,
    },
    sampledAtUnixMs: value.sampledAtUnixMs,
    monotonicElapsedNs: value.monotonicElapsedNs,
    cpu: {
      cumulativeTime,
      usageCores,
      measurementWindow,
    },
    memory: {
      workingSetBytes: metric(value.memory.workingSetBytes, 'bytes', readByteCount),
      privateBytes: metric(value.memory.privateBytes, 'bytes', readByteCount),
    },
  };
}

function parseSampleEnvelope(value: unknown): BetaDiagnosticsSample {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'deviceId', 'runtimeId', 'process'])) return invalidResponse();
  if (value.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION || !isIdentifier(value.deviceId) || !isIdentifier(value.runtimeId)) return invalidResponse();
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    deviceId: value.deviceId,
    runtimeId: value.runtimeId,
    process: parseProcessResourceSample(value.process),
  };
}

function parseAppliedBudget(value: unknown): StorageScanReport['appliedBudget'] {
  const keys = ['maxEntries', 'maxFiles', 'maxDirectories', 'maxLogicalBytes', 'maxElapsedMs'] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys) || !keys.every(key => isSafeCount(value[key]))) return invalidResponse();
  return {
    maxEntries: value.maxEntries as number,
    maxFiles: value.maxFiles as number,
    maxDirectories: value.maxDirectories as number,
    maxLogicalBytes: value.maxLogicalBytes as number,
    maxElapsedMs: value.maxElapsedMs as number,
  };
}

function parseStorageArea(value: unknown): StorageAreaTotals {
  if (!isRecord(value) || !hasExactKeys(value, ['area', 'fileCount', 'directoryCount', 'logicalBytesCounted'])) return invalidResponse();
  if (!(AREAS as readonly unknown[]).includes(value.area) || !isSafeCount(value.fileCount)
    || !isSafeCount(value.directoryCount) || !isSafeCount(value.logicalBytesCounted)) return invalidResponse();
  return {
    area: value.area as StorageArea,
    fileCount: value.fileCount,
    directoryCount: value.directoryCount,
    logicalBytesCounted: value.logicalBytesCounted,
  };
}

function parseStorageReport(value: unknown): StorageScanReport {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'scope', 'recursiveWithoutLinks', 'status', 'partialReasons', 'startedAtUnixMs', 'finishedAtUnixMs',
    'elapsedNs', 'appliedBudget', 'entriesExamined', 'directoriesExamined', 'filesExamined', 'skippedLinkEntries',
    'skippedSpecialEntries', 'logicalBytesCounted', 'areas',
  ])) return invalidResponse();
  if (value.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION || value.scope !== 'native_provided_host_root'
    || value.recursiveWithoutLinks !== true || (value.status !== 'complete' && value.status !== 'partial')) return invalidResponse();
  if (!Array.isArray(value.partialReasons) || value.partialReasons.length > DIAGNOSTIC_REASONS.length
    || !value.partialReasons.every(isReason)) return invalidResponse();
  const partialReasons: DiagnosticReason[] = value.partialReasons.filter(isReason);
  if ((value.status === 'partial') !== (partialReasons.length > 0)) return invalidResponse();
  if (!isUnixMilliseconds(value.startedAtUnixMs) || !isUnixMilliseconds(value.finishedAtUnixMs) || !isDecimalU64(value.elapsedNs)) return invalidResponse();
  const counts = ['entriesExamined', 'directoriesExamined', 'filesExamined', 'skippedLinkEntries', 'skippedSpecialEntries', 'logicalBytesCounted'] as const;
  if (!counts.every(key => isSafeCount(value[key])) || !Array.isArray(value.areas) || value.areas.length !== AREAS.length) return invalidResponse();
  const areas = value.areas.map(parseStorageArea);
  if (new Set(areas.map(area => area.area)).size !== AREAS.length) return invalidResponse();

  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    scope: 'native_provided_host_root',
    recursiveWithoutLinks: true,
    status: value.status,
    partialReasons,
    startedAtUnixMs: value.startedAtUnixMs,
    finishedAtUnixMs: value.finishedAtUnixMs,
    elapsedNs: value.elapsedNs,
    appliedBudget: parseAppliedBudget(value.appliedBudget),
    entriesExamined: value.entriesExamined as number,
    directoriesExamined: value.directoriesExamined as number,
    filesExamined: value.filesExamined as number,
    skippedLinkEntries: value.skippedLinkEntries as number,
    skippedSpecialEntries: value.skippedSpecialEntries as number,
    logicalBytesCounted: value.logicalBytesCounted as number,
    areas,
  };
}

function parseStorageEnvelope(value: unknown, expectedScanId: string): BetaDiagnosticsStorageEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'deviceId', 'runtimeId', 'scanId', 'storage'])) return invalidResponse();
  if (value.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION || !isIdentifier(value.deviceId) || !isIdentifier(value.runtimeId)
    || value.scanId !== expectedScanId) return invalidResponse();
  const storage = parseStorageReport(value.storage);
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    deviceId: value.deviceId,
    runtimeId: value.runtimeId,
    scanId: expectedScanId,
    storage,
  };
}

function parseCancellation(value: unknown, expectedScanId: string): BetaDiagnosticsCancellation {
  if (!isRecord(value) || !hasExactKeys(value, ['scanId', 'cancellationRequested']) || value.scanId !== expectedScanId
    || typeof value.cancellationRequested !== 'boolean') return invalidResponse();
  return { scanId: expectedScanId, cancellationRequested: value.cancellationRequested };
}

function safeInvoke(call: NativeDiagnosticsInvoke, command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return args === undefined ? call(command) : call(command, args);
  } catch {
    return Promise.reject(new BetaDiagnosticsClientError('request_failed'));
  }
}

/** Creates the fixed Native IPC adapter. Web builds return no capability and never start an HTTP fallback. */
export function createBetaDiagnosticsClient(options: ClientFactoryOptions = {}): BetaDiagnosticsClient | null {
  const native = options.isTauri?.() ?? isTauri();
  if (!native) return null;
  const call: NativeDiagnosticsInvoke = options.invoke ?? ((command, args) => (
    args === undefined ? tauriInvoke<unknown>(command) : tauriInvoke<unknown>(command, args)
  ));

  async function request(command: string, args?: Record<string, unknown>): Promise<unknown> {
    try {
      return await safeInvoke(call, command, args);
    } catch {
      throw new BetaDiagnosticsClientError('request_failed');
    }
  }

  return {
    async sample() {
      return parseSampleEnvelope(await request('beta_diagnostics_sample'));
    },
    async scanStorage(scanId) {
      if (!isIdentifier(scanId)) invalidResponse();
      return parseStorageEnvelope(await request('beta_diagnostics_storage', { scanId }), scanId);
    },
    async cancelStorage(scanId) {
      if (!isIdentifier(scanId)) invalidResponse();
      return parseCancellation(await request('beta_diagnostics_storage_cancel', { scanId }), scanId);
    },
  };
}
