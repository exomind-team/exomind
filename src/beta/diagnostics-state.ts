import type {
  BetaDiagnosticsSample,
  BetaDiagnosticsStorageEnvelope,
  DiagnosticReason,
  ProcessMetric,
  ProcessResourceSample,
  StorageAreaTotals,
  StorageScanReport,
} from './diagnostics-client';

export const MAX_DIAGNOSTIC_SAMPLES = 180;
export const DIAGNOSTICS_SAMPLE_INTERVAL_MS = 5_000;
export const MAX_DIAGNOSTICS_EXPORT_BYTES = 64 * 1024;
const MAX_TREND_GAP_MS = DIAGNOSTICS_SAMPLE_INTERVAL_MS * 2;

export interface DiagnosticsHistoryScope {
  deviceId: string;
  runtimeId: string;
  pid: number;
  collectorLifecycle: string;
}

export interface DiagnosticsHistory {
  scope: DiagnosticsHistoryScope | null;
  samples: BetaDiagnosticsSample[];
}

export type AppendSampleResult = {
  kind: 'appended' | 'scope_reset' | 'out_of_order';
  history: DiagnosticsHistory;
};

export interface DiagnosticTrendPoint {
  elapsedMs: number;
  value: number;
  sampledAtUnixMs: number | null;
  measurementWindowNs: string | null;
}

export type DiagnosticTrendMetric = 'cpu_usage_cores' | 'working_set_bytes';

export interface DiagnosticsExportPayload {
  schemaVersion: 1;
  exportedAtUnixMs: number;
  scope: {
    deviceId: string;
    runtimeId: string;
    processScope: 'native_host_process';
    pid: number;
    collectorLifecycle: string;
  };
  snapshot: ProcessResourceSample;
  history: {
    capacity: number;
    availableSampleCount: number;
    exportedSampleCount: number;
    trimmedForByteBudget: boolean;
    window: {
      fromSampledAtUnixMs: number | null;
      toSampledAtUnixMs: number | null;
      elapsedNs: string;
    };
    samples: ProcessResourceSample[];
  };
  storage: {
    scanId: string;
    deviceId: string;
    runtimeId: string;
    report: StorageScanReport;
  } | null;
}

export interface DiagnosticsExportBundle {
  payload: DiagnosticsExportPayload;
  json: string;
  bytes: number;
}

export class DiagnosticsExportError extends Error {
  constructor(readonly code: 'missing_snapshot' | 'scope_mismatch' | 'size_limit' | 'encoder_unavailable') {
    super(code === 'missing_snapshot'
      ? '尚无有效样本，暂时无法导出。'
      : code === 'scope_mismatch'
        ? '诊断数据的运行范围已变化，请刷新快照后再导出。'
        : code === 'encoder_unavailable'
          ? '当前窗口缺少 JSON 大小校验能力，无法安全导出。'
          : '本机 JSON 超出导出上限；请缩短采样窗口后重试。');
    this.name = 'DiagnosticsExportError';
  }
}

export function createEmptyDiagnosticsHistory(): DiagnosticsHistory {
  return { scope: null, samples: [] };
}

function sampleScope(sample: BetaDiagnosticsSample): DiagnosticsHistoryScope {
  return {
    deviceId: sample.deviceId,
    runtimeId: sample.runtimeId,
    pid: sample.process.identity.pid,
    collectorLifecycle: sample.process.identity.collectorLifecycle,
  };
}

function sameScope(left: DiagnosticsHistoryScope, right: DiagnosticsHistoryScope): boolean {
  return left.deviceId === right.deviceId
    && left.runtimeId === right.runtimeId
    && left.pid === right.pid
    && left.collectorLifecycle === right.collectorLifecycle;
}

export function appendDiagnosticSample(history: DiagnosticsHistory, sample: BetaDiagnosticsSample): AppendSampleResult {
  const nextScope = sampleScope(sample);
  if (history.scope && !sameScope(history.scope, nextScope)) {
    return { kind: 'scope_reset', history: { scope: nextScope, samples: [sample] } };
  }
  const last = history.samples[history.samples.length - 1];
  if (last && BigInt(sample.process.monotonicElapsedNs) <= BigInt(last.process.monotonicElapsedNs)) {
    return { kind: 'out_of_order', history };
  }
  const samples = [...history.samples, sample].slice(-MAX_DIAGNOSTIC_SAMPLES);
  return { kind: 'appended', history: { scope: nextScope, samples } };
}

function approximateMilliseconds(nanoseconds: bigint): number {
  const wholeMilliseconds = nanoseconds / 1_000_000n;
  const remainderNanoseconds = nanoseconds % 1_000_000n;
  return Number(wholeMilliseconds) + Number(remainderNanoseconds) / 1_000_000;
}

function trendMetric(sample: BetaDiagnosticsSample, metric: DiagnosticTrendMetric): ProcessMetric<number> {
  return metric === 'cpu_usage_cores'
    ? sample.process.cpu.usageCores
    : sample.process.memory.workingSetBytes;
}

export function metricTrendSegments(
  samples: readonly BetaDiagnosticsSample[],
  metric: DiagnosticTrendMetric,
): DiagnosticTrendPoint[][] {
  if (samples.length === 0) return [];
  const firstNs = BigInt(samples[0].process.monotonicElapsedNs);
  const segments: DiagnosticTrendPoint[][] = [];
  let current: DiagnosticTrendPoint[] = [];
  let previousNs: bigint | null = null;

  for (const sample of samples) {
    const elapsedNs = BigInt(sample.process.monotonicElapsedNs);
    if (previousNs !== null && elapsedNs <= previousNs) {
      if (current.length > 0) segments.push(current);
      current = [];
      previousNs = null;
      continue;
    }
    const gapMs = previousNs === null ? null : approximateMilliseconds(elapsedNs - previousNs);
    if (gapMs !== null && gapMs > MAX_TREND_GAP_MS && current.length > 0) {
      segments.push(current);
      current = [];
    }

    const value = trendMetric(sample, metric);
    if (value.availability === 'unknown') {
      if (current.length > 0) segments.push(current);
      current = [];
      previousNs = elapsedNs;
      continue;
    }
    const measurementWindowNs = metric === 'cpu_usage_cores'
      ? sample.process.cpu.measurementWindow.value
      : null;
    current.push({
      elapsedMs: approximateMilliseconds(elapsedNs - firstNs),
      value: value.value,
      sampledAtUnixMs: sample.process.sampledAtUnixMs,
      measurementWindowNs,
    });
    previousNs = elapsedNs;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function copyMetric<T>(metric: ProcessMetric<T>): ProcessMetric<T> {
  return metric.availability === 'available'
    ? { value: metric.value, unit: metric.unit, availability: 'available', reason: null }
    : { value: null, unit: metric.unit, availability: 'unknown', reason: metric.reason as DiagnosticReason };
}

function copyProcessSample(sample: ProcessResourceSample): ProcessResourceSample {
  return {
    schemaVersion: 1,
    scope: 'native_host_process',
    identity: {
      pid: sample.identity.pid,
      collectorLifecycle: sample.identity.collectorLifecycle,
    },
    sampledAtUnixMs: sample.sampledAtUnixMs,
    monotonicElapsedNs: sample.monotonicElapsedNs,
    cpu: {
      cumulativeTime: copyMetric(sample.cpu.cumulativeTime),
      usageCores: copyMetric(sample.cpu.usageCores),
      measurementWindow: copyMetric(sample.cpu.measurementWindow),
    },
    memory: {
      workingSetBytes: copyMetric(sample.memory.workingSetBytes),
      privateBytes: copyMetric(sample.memory.privateBytes),
    },
  };
}

function copyStorageArea(area: StorageAreaTotals): StorageAreaTotals {
  return {
    area: area.area,
    fileCount: area.fileCount,
    directoryCount: area.directoryCount,
    logicalBytesCounted: area.logicalBytesCounted,
  };
}

function copyStorage(envelope: BetaDiagnosticsStorageEnvelope): DiagnosticsExportPayload['storage'] {
  const report = envelope.storage;
  return {
    scanId: envelope.scanId,
    deviceId: envelope.deviceId,
    runtimeId: envelope.runtimeId,
    report: {
      schemaVersion: 1,
      scope: 'native_provided_host_root',
      recursiveWithoutLinks: true,
      status: report.status,
      partialReasons: [...report.partialReasons],
      startedAtUnixMs: report.startedAtUnixMs,
      finishedAtUnixMs: report.finishedAtUnixMs,
      elapsedNs: report.elapsedNs,
      appliedBudget: {
        maxEntries: report.appliedBudget.maxEntries,
        maxFiles: report.appliedBudget.maxFiles,
        maxDirectories: report.appliedBudget.maxDirectories,
        maxLogicalBytes: report.appliedBudget.maxLogicalBytes,
        maxElapsedMs: report.appliedBudget.maxElapsedMs,
      },
      entriesExamined: report.entriesExamined,
      directoriesExamined: report.directoriesExamined,
      filesExamined: report.filesExamined,
      skippedLinkEntries: report.skippedLinkEntries,
      skippedSpecialEntries: report.skippedSpecialEntries,
      logicalBytesCounted: report.logicalBytesCounted,
      areas: report.areas.map(copyStorageArea),
    },
  };
}

function matchingScope(snapshot: BetaDiagnosticsSample, history: DiagnosticsHistory): boolean {
  if (!history.scope) return history.samples.length === 0;
  const last = history.samples[history.samples.length - 1];
  return sameScope(history.scope, sampleScope(snapshot))
    && history.samples.every(sample => sameScope(history.scope!, sampleScope(sample)))
    && (!last || snapshot.process.monotonicElapsedNs === last.process.monotonicElapsedNs);
}

function makeExportPayload(
  snapshot: BetaDiagnosticsSample,
  samples: readonly BetaDiagnosticsSample[],
  availableSampleCount: number,
  storage: BetaDiagnosticsStorageEnvelope | null,
  exportedAtUnixMs: number,
): DiagnosticsExportPayload {
  const processSnapshot = copyProcessSample(snapshot.process);
  const first = samples[0]?.process;
  const last = samples[samples.length - 1]?.process;
  const elapsedNs = first && last
    ? (BigInt(last.monotonicElapsedNs) - BigInt(first.monotonicElapsedNs)).toString()
    : '0';
  return {
    schemaVersion: 1,
    exportedAtUnixMs,
    scope: {
      deviceId: snapshot.deviceId,
      runtimeId: snapshot.runtimeId,
      processScope: 'native_host_process',
      pid: snapshot.process.identity.pid,
      collectorLifecycle: snapshot.process.identity.collectorLifecycle,
    },
    snapshot: processSnapshot,
    history: {
      capacity: MAX_DIAGNOSTIC_SAMPLES,
      availableSampleCount,
      exportedSampleCount: samples.length,
      trimmedForByteBudget: samples.length < availableSampleCount,
      window: {
        fromSampledAtUnixMs: first?.sampledAtUnixMs ?? null,
        toSampledAtUnixMs: last?.sampledAtUnixMs ?? null,
        elapsedNs,
      },
      samples: samples.map(sample => copyProcessSample(sample.process)),
    },
    storage: storage ? copyStorage(storage) : null,
  };
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder === 'undefined') throw new DiagnosticsExportError('encoder_unavailable');
  return new TextEncoder().encode(value).byteLength;
}

export function buildDiagnosticsExport(input: {
  snapshot: BetaDiagnosticsSample | null;
  history: DiagnosticsHistory;
  storage: BetaDiagnosticsStorageEnvelope | null;
  exportedAtUnixMs: number;
}): DiagnosticsExportBundle {
  const { snapshot, history, storage, exportedAtUnixMs } = input;
  if (!snapshot) throw new DiagnosticsExportError('missing_snapshot');
  if (!Number.isSafeInteger(exportedAtUnixMs) || exportedAtUnixMs < 0 || !matchingScope(snapshot, history)) {
    throw new DiagnosticsExportError('scope_mismatch');
  }
  if (storage && (storage.deviceId !== snapshot.deviceId || storage.runtimeId !== snapshot.runtimeId)) {
    throw new DiagnosticsExportError('scope_mismatch');
  }

  const availableSampleCount = Math.min(history.samples.length, MAX_DIAGNOSTIC_SAMPLES);
  let samples = history.samples.slice(-MAX_DIAGNOSTIC_SAMPLES);
  while (true) {
    const payload = makeExportPayload(snapshot, samples, availableSampleCount, storage, exportedAtUnixMs);
    const json = JSON.stringify(payload, null, 2);
    const bytes = utf8ByteLength(json);
    if (bytes <= MAX_DIAGNOSTICS_EXPORT_BYTES) return { payload, json, bytes };
    if (samples.length === 0) throw new DiagnosticsExportError('size_limit');
    samples = samples.slice(1);
  }
}

export interface DiagnosticsDownloadAnchor {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}

export interface DiagnosticsDownloadPlatform {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  createAnchor?: () => DiagnosticsDownloadAnchor;
  scheduleRevoke?: (callback: () => void) => unknown;
}

export type DiagnosticsDownloadResult = { ok: true } | { ok: false; reason: 'unsupported' | 'failed' };

function browserDownloadPlatform(): DiagnosticsDownloadPlatform {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function'
    || typeof URL.revokeObjectURL !== 'function' || typeof document === 'undefined' || !document.body) return {};
  return {
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    createAnchor: () => {
      const anchor = document.createElement('a');
      anchor.hidden = true;
      document.body.append(anchor);
      return anchor;
    },
    scheduleRevoke: callback => window.setTimeout(callback, 0),
  };
}

export function triggerDiagnosticsDownload(
  json: string,
  platform: DiagnosticsDownloadPlatform = browserDownloadPlatform(),
): DiagnosticsDownloadResult {
  if (typeof Blob === 'undefined' || !platform.createObjectURL || !platform.revokeObjectURL || !platform.createAnchor) {
    return { ok: false, reason: 'unsupported' };
  }
  let url: string | null = null;
  let anchor: DiagnosticsDownloadAnchor | null = null;
  try {
    url = platform.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    anchor = platform.createAnchor();
    anchor.href = url;
    anchor.download = 'exomind-beta-diagnostics.json';
    anchor.click();
    anchor.remove();
    anchor = null;
    const objectUrl = url;
    if (platform.scheduleRevoke) platform.scheduleRevoke(() => platform.revokeObjectURL?.(objectUrl));
    else platform.revokeObjectURL(objectUrl);
    return { ok: true };
  } catch {
    anchor?.remove();
    if (url) platform.revokeObjectURL(url);
    return { ok: false, reason: 'failed' };
  }
}
