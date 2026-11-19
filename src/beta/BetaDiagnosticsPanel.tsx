import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Clipboard, Cpu, Download, HardDrive, MemoryStick, Pause, RefreshCw, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FieldSelect } from '@/components/ui/field-select';
import {
  BetaDiagnosticsClientError,
  type BetaDiagnosticsClient,
  type BetaDiagnosticsSample,
  type BetaDiagnosticsStorageEnvelope,
  type DiagnosticReason,
  type StorageArea,
} from './diagnostics-client';
import {
  appendDiagnosticSample,
  buildDiagnosticsExport,
  createEmptyDiagnosticsHistory,
  DIAGNOSTICS_SAMPLE_INTERVAL_MS,
  metricTrendSegments,
  triggerDiagnosticsDownload,
  type DiagnosticTrendMetric,
  type DiagnosticsHistory,
  type DiagnosticTrendPoint,
} from './diagnostics-state';

export interface BetaDiagnosticsPanelProps {
  client: BetaDiagnosticsClient | null;
  visible: boolean;
}

/** Settings mounting does not mean that the user opened diagnostics. */
export function BetaDiagnosticsEntry({ client, visible }: BetaDiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  return <Dialog open={open && visible} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Activity aria-hidden="true" className="mr-2 h-4 w-4" />查看运行诊断
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-6xl overflow-y-auto">
        <DialogHeader className="sr-only">
          <DialogTitle>运行诊断</DialogTitle>
          <DialogDescription>按需查看本机进程和存储；关闭后停止诊断观察。</DialogDescription>
        </DialogHeader>
        <BetaDiagnosticsPanel client={client} visible={open && visible} />
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setOpen(false)}>关闭运行诊断</Button>
        </div>
      </DialogContent>
    </Dialog>;
}

type SampleStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
type ScanActivity =
  | { kind: 'idle' }
  | { kind: 'scanning'; scanId: string; cancellation: 'none' | 'requesting' | 'requested' | 'not_confirmed' }
  | { kind: 'out_of_scope'; scanId: string }
  | { kind: 'error' };

interface ActiveScan {
  client: BetaDiagnosticsClient;
  scanId: string;
  panelToken: number;
  generation: number;
}

interface ActiveSample {
  client: BetaDiagnosticsClient;
  panelToken: number;
  sampleEpoch: number;
  promise: Promise<void>;
}

const TREND_WINDOWS = [
  { value: '300000', label: '最近 5 分钟' },
  { value: '900000', label: '最近 15 分钟' },
  { value: 'all', label: '全部保留样本' },
] as const;

const REASON_LABELS: Record<DiagnosticReason, string> = {
  unsupported: '当前平台未支持此字段',
  permission_denied: '系统权限不足',
  unavailable: '当前无法取得',
  invalid_data: '来源数据无法识别',
  initial_sample: '首次样本尚无差分窗口',
  identity_changed: '进程或采集生命周期已变化',
  counter_regressed: '累计计数发生回退',
  clock_did_not_advance: '单调时间尚未推进',
  clock_regressed: '单调时钟发生回退',
  budget_exceeded: '扫描预算已到上限',
  cancelled: '扫描收到取消请求',
  entry_unavailable: '部分条目无法读取元数据',
  invalid_root: 'Native 提供的扫描范围不可用',
};

const STORAGE_AREA_LABELS: Record<StorageArea, string> = {
  host_root: 'Host 根层',
  core_store: 'Core 存储',
  native_private_ui: 'Native 私有 UI',
  local_source_store: '本机来源副本',
  peer_identity: '对等身份',
  unclassified: '未分类条目',
};

function isDocumentVisible(): boolean {
  return typeof document === 'undefined'
    || (document.visibilityState !== 'hidden' && document.hidden !== true);
}

function formatWallTime(value: number | null): string {
  if (value === null) return '来源未提供时间';
  return new Date(value).toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function approximateMilliseconds(nanoseconds: string): number {
  const value = BigInt(nanoseconds);
  return Number(value / 1_000_000n) + Number(value % 1_000_000n) / 1_000_000;
}

function formatElapsed(nanoseconds: string | null): string {
  if (nanoseconds === null) return '没有可比较窗口';
  const milliseconds = approximateMilliseconds(nanoseconds);
  if (milliseconds < 1_000) return `${milliseconds.toFixed(1)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(2)} s`;
  return `${(milliseconds / 60_000).toFixed(2)} min`;
}

function formatApproximateDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds.toFixed(0)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

function formatCpu(value: number | null): string {
  if (value === null) return '未知';
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  return `${formatted} 核`;
}

function safeSampleFailure(error: unknown): string {
  if (error instanceof BetaDiagnosticsClientError && error.code === 'invalid_response') {
    return '本机诊断响应格式无法识别，已忽略本次结果。';
  }
  return '本机进程样本读取未确认；已保留最后真实样本，可手动重试。';
}

function safeStorageFailure(error: unknown): string {
  if (error instanceof BetaDiagnosticsClientError && error.code === 'invalid_response') {
    return '存储扫描响应格式无法识别，已忽略本次结果。';
  }
  return '本机存储扫描未确认；现有结果仍保留，可在稍后重试。';
}

function getWindowSamples(samples: readonly BetaDiagnosticsSample[], windowMs: string): BetaDiagnosticsSample[] {
  if (windowMs === 'all' || samples.length === 0) return [...samples];
  const windowNs = BigInt(windowMs) * 1_000_000n;
  const newestNs = BigInt(samples[samples.length - 1].process.monotonicElapsedNs);
  const cutoff = newestNs - windowNs;
  return samples.filter(sample => BigInt(sample.process.monotonicElapsedNs) >= cutoff);
}

function pointCoordinates(segments: readonly DiagnosticTrendPoint[][]): { segments: Array<Array<{ x: number; y: number }>>; pointCount: number } {
  const points = segments.flat();
  if (points.length === 0) return { segments: [], pointCount: 0 };
  const maxX = Math.max(...points.map(point => point.elapsedMs), 1);
  const minY = Math.min(...points.map(point => point.value));
  const maxY = Math.max(...points.map(point => point.value));
  const valueRange = maxY === minY ? 1 : maxY - minY;
  return {
    pointCount: points.length,
    segments: segments.map(segment => segment.map(point => ({
      x: 12 + (point.elapsedMs / maxX) * 296,
      y: 72 - ((point.value - minY) / valueRange) * 56,
    }))),
  };
}

function TrendChart({
  title,
  metric,
  samples,
  unit,
  formatValue,
}: {
  title: string;
  metric: DiagnosticTrendMetric;
  samples: readonly BetaDiagnosticsSample[];
  unit: string;
  formatValue: (value: number) => string;
}) {
  const segments = metricTrendSegments(samples, metric);
  const chart = pointCoordinates(segments);
  const hasPoints = chart.pointCount > 0;
  const gapCount = Math.max(0, segments.length - 1);
  const points = segments.flat();
  const elapsedRange = points.length > 0 ? Math.max(...points.map(point => point.elapsedMs)) : 0;
  const valueRange = points.length > 0
    ? `${formatValue(Math.min(...points.map(point => point.value)))}–${formatValue(Math.max(...points.map(point => point.value)))}`
    : '';
  const accessibleName = `${title}趋势，${chart.pointCount} 个真实样本，${gapCount} 处缺测或停观断点`;

  if (!hasPoints) {
    return (
      <div role="img" aria-label={`${title}趋势，目前没有可画的真实样本`} className="flex h-20 items-center justify-center rounded-xl bg-muted/50 text-xs text-muted-foreground">
        尚无可画样本
      </div>
    );
  }

  return (
    <div role="img" aria-label={accessibleName} className="rounded-xl bg-muted/40 px-2 py-1">
      <svg aria-hidden="true" viewBox="0 0 320 84" className="h-20 w-full text-brand-accent">
        {chart.segments.map((segment, segmentIndex) => (
          <g key={`${segmentIndex}-${segment.length}`} className="fill-current stroke-current">
            {segment.length > 1 && (
              <polyline
                points={segment.map(point => `${point.x},${point.y}`).join(' ')}
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {segment.map((point, pointIndex) => (
              <circle key={`${segmentIndex}-${pointIndex}`} cx={point.x} cy={point.y} r="2.5" stroke="none" />
            ))}
          </g>
        ))}
      </svg>
      <p className="sr-only">{title}数值单位为{unit}。横向位置按采集器单调时间排列；断开的线段表示缺少可比较样本，不插值。</p>
      <p className="px-1 pb-1 text-[11px] text-muted-foreground">
        {chart.pointCount} 个真实样本 · {valueRange} · 相对单调时间 {formatApproximateDuration(elapsedRange)} · {gapCount > 0 ? `${gapCount} 处断点` : '无缺测断点'}
      </p>
    </div>
  );
}

function MetricCard({
  title,
  icon,
  value,
  subject,
  source,
  sampleTime,
  window,
  children,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  subject: string;
  source: string;
  sampleTime: string;
  window: string;
  children?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section role="group" aria-labelledby={headingId} className="min-w-0 rounded-2xl border border-border-card bg-card p-3 shadow-sm sm:p-4">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {icon}
        <h3 id={headingId} className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h3>
      </div>
      <div className="mt-3 flex min-h-10 items-center overflow-hidden text-2xl font-semibold tabular-nums tracking-tight text-foreground" aria-live="polite">
        <span className="min-w-0 break-all">{value}</span>
      </div>
      <div className="mt-3 space-y-1 text-[11px] leading-4 text-muted-foreground">
        <p>主体：{subject}</p>
        <p>来源：{source}</p>
        <p className="break-words">样本：{sampleTime}</p>
        <p>测量窗口：{window}</p>
      </div>
      {children ? <div className="mt-3 min-w-0">{children}</div> : null}
    </section>
  );
}

function createScanId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `diagnostics-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function storageReasonLabel(reason: DiagnosticReason): string {
  return REASON_LABELS[reason];
}

export function BetaDiagnosticsPanel({ client, visible }: BetaDiagnosticsPanelProps) {
  const [currentSample, setCurrentSample] = useState<BetaDiagnosticsSample | null>(null);
  const [history, setHistory] = useState<DiagnosticsHistory>(createEmptyDiagnosticsHistory);
  const [sampleStatus, setSampleStatus] = useState<SampleStatus>('idle');
  const [sampleFailure, setSampleFailure] = useState<string | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [observing, setObserving] = useState(false);
  const [observationStarted, setObservationStarted] = useState(false);
  const [observationPaused, setObservationPaused] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(isDocumentVisible);
  const [scanActivity, setScanActivity] = useState<ScanActivity>({ kind: 'idle' });
  const [storageResult, setStorageResult] = useState<BetaDiagnosticsStorageEnvelope | null>(null);
  const [storageFailure, setStorageFailure] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [trendWindow, setTrendWindow] = useState('all');
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const clientRef = useRef(client);
  const visibleRef = useRef(visible);
  const currentSampleRef = useRef<BetaDiagnosticsSample | null>(null);
  const historyRef = useRef<DiagnosticsHistory>(createEmptyDiagnosticsHistory());
  const panelTokenRef = useRef(0);
  const sampleEpochRef = useRef(0);
  const sampleFlightRef = useRef<ActiveSample | null>(null);
  const observationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observingRef = useRef(false);
  const documentVisibleRef = useRef(isDocumentVisible());
  const activeScanRef = useRef<ActiveScan | null>(null);
  const scanGenerationRef = useRef(0);
  const abandonedScanIdRef = useRef<string | null>(null);
  const previousClientRef = useRef(client);

  clientRef.current = client;
  visibleRef.current = visible;
  currentSampleRef.current = currentSample;
  historyRef.current = history;

  const stopObservationTimer = useCallback(() => {
    if (observationTimerRef.current !== null) {
      clearTimeout(observationTimerRef.current);
      observationTimerRef.current = null;
    }
  }, []);

  const abandonActiveScan = useCallback((): string | null => {
    const active = activeScanRef.current;
    if (!active) return null;
    activeScanRef.current = null;
    scanGenerationRef.current += 1;
    abandonedScanIdRef.current = active.scanId;
    void active.client.cancelStorage(active.scanId).catch(() => {});
    return active.scanId;
  }, []);

  const invalidatePanelToken = useCallback((token: number, updateUi: boolean, reason: string) => {
    if (panelTokenRef.current !== token) return null;
    panelTokenRef.current += 1;
    sampleEpochRef.current += 1;
    stopObservationTimer();
    observingRef.current = false;
    const abandonedScanId = abandonActiveScan();
    if (updateUi) {
      setObserving(false);
      setObservationStarted(false);
      setObservationPaused(false);
      setSampleStatus(currentSampleRef.current ? 'ready' : clientRef.current ? 'idle' : 'unsupported');
      if (!currentSampleRef.current) setSampleFailure(null);
      setPauseReason(reason);
      if (abandonedScanId) setScanActivity({ kind: 'out_of_scope', scanId: abandonedScanId });
    }
    return abandonedScanId;
  }, [abandonActiveScan, stopObservationTimer]);

  const isCurrentSampleRequest = useCallback((panelToken: number, sampleEpoch: number) => (
    panelTokenRef.current === panelToken
    && sampleEpochRef.current === sampleEpoch
    && visibleRef.current
    && documentVisibleRef.current
  ), []);

  const acceptSample = useCallback((next: BetaDiagnosticsSample) => {
    const appended = appendDiagnosticSample(historyRef.current, next);
    if (appended.kind === 'out_of_order') {
      setSampleStatus(currentSampleRef.current ? 'ready' : 'idle');
      setSampleFailure(null);
      setScopeNotice('已忽略单调时序早于当前窗口的迟到样本。');
      return;
    }
    if (appended.kind === 'scope_reset') {
      const abandonedScanId = abandonActiveScan();
      setStorageResult(null);
      setStorageFailure(null);
      setScanActivity(abandonedScanId ? { kind: 'out_of_scope', scanId: abandonedScanId } : { kind: 'idle' });
      setScopeNotice('运行身份或采集生命周期已变化；旧曲线和旧存储结果已分开。');
    } else {
      setScopeNotice(null);
    }
    historyRef.current = appended.history;
    currentSampleRef.current = next;
    setHistory(appended.history);
    setCurrentSample(next);
    setSampleStatus('ready');
    setSampleFailure(null);
  }, [abandonActiveScan]);

  const requestSample = useCallback((panelToken: number, sampleEpoch: number): Promise<void> => {
    if (!isCurrentSampleRequest(panelToken, sampleEpoch) || !clientRef.current) return Promise.resolve();
    const currentFlight = sampleFlightRef.current;
    if (currentFlight) {
      if (currentFlight.panelToken === panelToken && currentFlight.sampleEpoch === sampleEpoch) return currentFlight.promise;
      return currentFlight.promise.catch(() => {}).then(() => (
        isCurrentSampleRequest(panelToken, sampleEpoch) ? requestSample(panelToken, sampleEpoch) : undefined
      ));
    }

    setSampleStatus('loading');
    setSampleFailure(null);
    const flight: ActiveSample = {
      client: clientRef.current,
      panelToken,
      sampleEpoch,
      promise: Promise.resolve(),
    };
    flight.promise = Promise.resolve().then(async () => {
      if (!isCurrentSampleRequest(panelToken, sampleEpoch)) return;
      try {
        const next = await flight.client.sample();
        if (isCurrentSampleRequest(panelToken, sampleEpoch)) acceptSample(next);
      } catch (error) {
        if (isCurrentSampleRequest(panelToken, sampleEpoch)) {
          setSampleStatus('error');
          setSampleFailure(safeSampleFailure(error));
        }
      }
    }).finally(() => {
      if (sampleFlightRef.current === flight) sampleFlightRef.current = null;
    });
    sampleFlightRef.current = flight;
    return flight.promise;
  }, [acceptSample, isCurrentSampleRequest]);

  const observationCycle = useCallback(async (panelToken: number, sampleEpoch: number) => {
    if (!observingRef.current || !isCurrentSampleRequest(panelToken, sampleEpoch)) return;
    if (sampleFlightRef.current) {
      observationTimerRef.current = setTimeout(() => {
        observationTimerRef.current = null;
        void observationCycle(panelToken, sampleEpoch);
      }, DIAGNOSTICS_SAMPLE_INTERVAL_MS);
      return;
    }
    await requestSample(panelToken, sampleEpoch);
    if (!observingRef.current || !isCurrentSampleRequest(panelToken, sampleEpoch)) return;
    observationTimerRef.current = setTimeout(() => {
      observationTimerRef.current = null;
      void observationCycle(panelToken, sampleEpoch);
    }, DIAGNOSTICS_SAMPLE_INTERVAL_MS);
  }, [isCurrentSampleRequest, requestSample]);

  const scheduleFirstObservation = useCallback((panelToken: number, sampleEpoch: number) => {
    stopObservationTimer();
    observationTimerRef.current = setTimeout(() => {
      observationTimerRef.current = null;
      void observationCycle(panelToken, sampleEpoch);
    }, DIAGNOSTICS_SAMPLE_INTERVAL_MS);
  }, [observationCycle, stopObservationTimer]);

  const startObservation = useCallback(() => {
    if (!clientRef.current || !visibleRef.current || !documentVisibleRef.current) return;
    const panelToken = panelTokenRef.current;
    const sampleEpoch = sampleEpochRef.current;
    stopObservationTimer();
    observingRef.current = true;
    setObserving(true);
    setObservationStarted(true);
    setObservationPaused(false);
    setPauseReason(null);
    scheduleFirstObservation(panelToken, sampleEpoch);
  }, [scheduleFirstObservation, stopObservationTimer]);

  const togglePauseObservation = useCallback(() => {
    if (!observationStarted) return;
    if (observingRef.current) {
      observingRef.current = false;
      sampleEpochRef.current += 1;
      stopObservationTimer();
      setObserving(false);
      setObservationPaused(true);
      setSampleStatus(currentSampleRef.current ? 'ready' : clientRef.current ? 'idle' : 'unsupported');
      if (!currentSampleRef.current) setSampleFailure(null);
      setPauseReason('已按需暂停；最后样本仍保留原始来源时间。');
      return;
    }
    if (observationPaused && visibleRef.current && documentVisibleRef.current && clientRef.current) {
      const panelToken = panelTokenRef.current;
      const sampleEpoch = sampleEpochRef.current;
      observingRef.current = true;
      setObserving(true);
      setObservationPaused(false);
      setPauseReason(null);
      scheduleFirstObservation(panelToken, sampleEpoch);
    }
  }, [observationPaused, observationStarted, scheduleFirstObservation, stopObservationTimer]);

  const refreshSnapshot = useCallback(() => {
    if (!clientRef.current || sampleFlightRef.current || observingRef.current || !visibleRef.current || !documentVisibleRef.current) return;
    const sampleEpoch = ++sampleEpochRef.current;
    void requestSample(panelTokenRef.current, sampleEpoch);
  }, [requestSample]);

  const startStorageScan = useCallback(() => {
    const currentClient = clientRef.current;
    if (!currentClient || !visibleRef.current || !documentVisibleRef.current || activeScanRef.current) return;
    const active: ActiveScan = {
      client: currentClient,
      scanId: createScanId(),
      panelToken: panelTokenRef.current,
      generation: ++scanGenerationRef.current,
    };
    activeScanRef.current = active;
    abandonedScanIdRef.current = null;
    setScanActivity({ kind: 'scanning', scanId: active.scanId, cancellation: 'none' });
    setStorageFailure(null);
    void active.client.scanStorage(active.scanId).then(envelope => {
      if (activeScanRef.current !== active || active.generation !== scanGenerationRef.current
        || panelTokenRef.current !== active.panelToken || !visibleRef.current || !documentVisibleRef.current) return;
      if (envelope.scanId !== active.scanId) {
        activeScanRef.current = null;
        setScanActivity({ kind: 'error' });
        setStorageFailure('扫描结果与当前请求 ID 不一致，已忽略本次结果。');
        return;
      }
      const current = currentSampleRef.current;
      if (current && (current.deviceId !== envelope.deviceId || current.runtimeId !== envelope.runtimeId)) {
        activeScanRef.current = null;
        setScanActivity({ kind: 'error' });
        setStorageFailure('扫描结果属于不同的运行身份，已忽略；请先刷新快照再扫描。');
        return;
      }
      activeScanRef.current = null;
      setStorageResult(envelope);
      setScanActivity({ kind: 'idle' });
      setStorageFailure(null);
    }).catch(error => {
      if (activeScanRef.current !== active || active.generation !== scanGenerationRef.current
        || panelTokenRef.current !== active.panelToken || !visibleRef.current || !documentVisibleRef.current) return;
      activeScanRef.current = null;
      setScanActivity({ kind: 'error' });
      setStorageFailure(safeStorageFailure(error));
    });
  }, []);

  const requestStorageCancellation = useCallback(() => {
    const active = activeScanRef.current;
    if (!active || !visibleRef.current) return;
    setScanActivity({ kind: 'scanning', scanId: active.scanId, cancellation: 'requesting' });
    void active.client.cancelStorage(active.scanId).then(result => {
      if (activeScanRef.current !== active || active.generation !== scanGenerationRef.current) return;
      if (result.scanId !== active.scanId) {
        setScanActivity({ kind: 'scanning', scanId: active.scanId, cancellation: 'not_confirmed' });
        return;
      }
      setScanActivity({
        kind: 'scanning',
        scanId: active.scanId,
        cancellation: result.cancellationRequested ? 'requested' : 'not_confirmed',
      });
    }).catch(() => {
      if (activeScanRef.current !== active || active.generation !== scanGenerationRef.current) return;
      setScanActivity({ kind: 'scanning', scanId: active.scanId, cancellation: 'not_confirmed' });
    });
  }, []);

  useEffect(() => {
    if (previousClientRef.current !== client) {
      previousClientRef.current = client;
      currentSampleRef.current = null;
      historyRef.current = createEmptyDiagnosticsHistory();
      setCurrentSample(null);
      setHistory(historyRef.current);
      setSampleStatus(client ? 'idle' : 'unsupported');
      setSampleFailure(null);
      setScopeNotice(null);
      setStorageResult(null);
      setStorageFailure(null);
      setScanActivity({ kind: 'idle' });
      abandonedScanIdRef.current = null;
      setDetailsOpen(false);
      setDetailNotice(null);
    }
    if (!visible) {
      invalidatePanelToken(panelTokenRef.current, false, '面板已关闭。');
      setObserving(false);
      setObservationStarted(false);
      setObservationPaused(false);
      setSampleStatus(currentSampleRef.current ? 'ready' : clientRef.current ? 'idle' : 'unsupported');
      if (!currentSampleRef.current) setSampleFailure(null);
      setPauseReason('面板已关闭；诊断观察已停止，重新打开后不会自动续采。');
      setDetailsOpen(false);
      setDetailNotice(null);
      setExportNotice(null);
      if (abandonedScanIdRef.current) {
        setScanActivity({ kind: 'out_of_scope', scanId: abandonedScanIdRef.current });
      }
      return;
    }

    const panelToken = ++panelTokenRef.current;
    const sampleEpoch = ++sampleEpochRef.current;
    setObserving(false);
    setObservationStarted(false);
    setObservationPaused(false);
    if (!client) {
      setSampleStatus('unsupported');
      setPauseReason(null);
    } else if (!isDocumentVisible()) {
      documentVisibleRef.current = false;
      setPauseReason('页面当前不可见；恢复后不会自动开始观察。');
    } else {
      documentVisibleRef.current = true;
      setPauseReason(null);
      void requestSample(panelToken, sampleEpoch);
    }

    return () => {
      invalidatePanelToken(panelToken, false, '面板已离开当前注意范围。');
    };
  }, [client, invalidatePanelToken, requestSample, visible]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const nextVisible = isDocumentVisible();
      documentVisibleRef.current = nextVisible;
      setDocumentVisible(nextVisible);
      if (!nextVisible) {
        invalidatePanelToken(panelTokenRef.current, true, '页面已隐藏；诊断采样和扫描已停止，返回后需手动重新开始。');
      } else if (visibleRef.current) {
        setObserving(false);
        setObservationStarted(false);
        setObservationPaused(false);
        setPauseReason('页面已恢复可见；可手动刷新或开始观察，不会自动续采。');
        if (abandonedScanIdRef.current) {
          setScanActivity({ kind: 'out_of_scope', scanId: abandonedScanIdRef.current });
        }
      }
    };
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [invalidatePanelToken]);

  const visibleSamples = useMemo(() => getWindowSamples(history.samples, trendWindow), [history.samples, trendWindow]);
  const latestProcess = currentSample?.process ?? null;
  const cpuMetric = latestProcess?.cpu.usageCores;
  const memoryMetric = latestProcess?.memory.workingSetBytes;
  const windowLabel = trendWindow === 'all' ? '全部保留样本（最多 180 个）' : `${Number(trendWindow) / 60_000} 分钟窗口`;
  const currentSampleTime = formatWallTime(latestProcess?.sampledAtUnixMs ?? null);

  const exportLocally = useCallback(() => {
    if (!currentSample) return;
    setExportNotice(null);
    try {
      const built = buildDiagnosticsExport({
        snapshot: currentSample,
        history: historyRef.current,
        storage: storageResult,
        exportedAtUnixMs: Date.now(),
      });
      const result = triggerDiagnosticsDownload(built.json);
      if (!result.ok && result.reason === 'unsupported') {
        setExportNotice('当前窗口缺少本机 JSON 下载能力；请在支持本机文件下载的 Beta 宿主中打开此面板。');
      } else if (!result.ok) {
        setExportNotice('本机 JSON 文件未能生成；可重试，采样数据仍留在当前面板。');
      } else {
        setExportNotice(`已准备本机 JSON（${formatBytes(built.bytes)}）；数据未上传。`);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        const code = error.code;
        setExportNotice(code === 'scope_mismatch'
          ? '运行身份已变化；请刷新快照后再导出。'
          : code === 'size_limit'
            ? '本机 JSON 超出固定大小上限；请缩短采样窗口后重试。'
            : code === 'encoder_unavailable'
              ? '当前窗口缺少 JSON 大小校验能力，无法安全导出。'
              : '尚无有效样本，暂时无法导出。');
      } else {
        setExportNotice('本机 JSON 导出未能完成；请重试。');
      }
    }
  }, [currentSample, storageResult]);

  const copyLocally = useCallback(async (value: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setDetailNotice('此窗口不支持剪贴板；下方精确值仍可本机选择并复制。');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setDetailNotice('已复制到本机剪贴板。');
    } catch {
      setDetailNotice('剪贴板写入未确认；下方精确值仍可本机选择并复制。');
    }
  }, []);

  if (!visible) return null;

  const cpuWindow = latestProcess?.cpu.measurementWindow.availability === 'available'
    ? formatElapsed(latestProcess.cpu.measurementWindow.value)
    : latestProcess?.cpu.measurementWindow.reason === 'initial_sample'
      ? '首次样本，没有差分窗口'
      : '来源未提供差分窗口';
  const storage = storageResult?.storage ?? null;
  const storageStatus = scanActivity.kind === 'scanning'
    ? '扫描进行中'
    : scanActivity.kind === 'out_of_scope'
      ? '结果已离开当前范围'
      : storage
        ? storage.status === 'complete' ? '扫描完成' : '部分扫描结果'
        : '尚未扫描';
  const storageValue = storage ? formatBytes(storage.logicalBytesCounted) : scanActivity.kind === 'scanning' ? '扫描中' : '未扫描';

  return (
    <div className="beta-ui min-w-0 space-y-4 text-foreground">
      <section className="min-w-0 rounded-2xl border border-border-card bg-card p-4 shadow-sm sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-brand-accent">
              <Activity aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wide">本机 · 手动诊断</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">运行诊断</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {client ? 'Native / Host 当前进程' : '本机 Native 诊断能力未接入'}
              {latestProcess ? ` · PID ${latestProcess.identity.pid}` : ''}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshSnapshot} disabled={!client || sampleStatus === 'loading' || observing || !documentVisible}>
              <RefreshCw aria-hidden="true" /> 刷新快照
            </Button>
            {!observationStarted ? (
              <Button variant="brand" size="sm" onClick={startObservation} disabled={!client || !documentVisible}>
                <Activity aria-hidden="true" /> 开始观察
              </Button>
            ) : (
              <Button variant={observationPaused ? 'secondary' : 'outline'} size="sm" aria-pressed={observationPaused} onClick={togglePauseObservation} disabled={!documentVisible}>
                <Pause aria-hidden="true" /> 暂停观测
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportLocally} disabled={!client || !currentSample}>
              <Download aria-hidden="true" /> 导出本机 JSON
            </Button>
          </div>
        </div>

        <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0 rounded-xl bg-muted/50 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">最近确认样本</p>
            <p className="mt-1 min-h-5 break-words text-sm font-medium tabular-nums">
              {latestProcess ? currentSampleTime : sampleStatus === 'loading' ? '正在读取一次快照…' : client ? '尚无已确认样本' : 'Native 能力未接入'}
            </p>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground sm:max-w-sm">
            仅覆盖 Native / Host 当前进程；不包含 WebView、GPU、其他进程或设备功耗。设备 USB 连接也不能说明净充电。
          </p>
        </div>
        <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {sampleFailure ? <p role="alert" className="text-destructive">{sampleFailure}</p> : null}
          {pauseReason ? <p role="status" className="text-muted-foreground">{pauseReason}</p> : null}
          {scopeNotice ? <p role="status" className="text-muted-foreground">{scopeNotice}</p> : null}
          {exportNotice ? <p role="status" className="text-muted-foreground">{exportNotice}</p> : null}
          {sampleStatus === 'loading' && latestProcess ? <p role="status" className="text-muted-foreground">正在读取；仍显示上一份真实样本及其来源时间。</p> : null}
        </div>
      </section>

      {client ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            title="CPU"
            icon={<Cpu aria-hidden="true" className="h-4 w-4 shrink-0" />}
            value={!latestProcess ? sampleStatus === 'loading' ? '读取中' : '尚无样本' : formatCpu(cpuMetric?.availability === 'available' ? cpuMetric.value : null)}
            subject="Native / Host 当前进程"
            source="进程累计 CPU 时间差分；1.0 核表示一个逻辑 CPU 满载"
            sampleTime={currentSampleTime}
            window={cpuWindow}
          >
            <TrendChart title="CPU 进程使用率" metric="cpu_usage_cores" samples={visibleSamples} unit="逻辑 CPU 核" formatValue={formatCpu} />
          </MetricCard>
          <MetricCard
            title="进程常驻内存"
            icon={<MemoryStick aria-hidden="true" className="h-4 w-4 shrink-0" />}
            value={!latestProcess ? sampleStatus === 'loading' ? '读取中' : '尚无样本' : memoryMetric?.availability === 'available' ? formatBytes(memoryMetric.value) : '未知'}
            subject="Native / Host 当前进程"
            source="OS working set 或平台 resident set；不是全应用总量"
            sampleTime={currentSampleTime}
            window="OS 单次快照"
          >
            <TrendChart title="进程常驻内存趋势" metric="working_set_bytes" samples={visibleSamples} unit="字节" formatValue={formatBytes} />
          </MetricCard>
          <MetricCard
            title="存储扫描"
            icon={<HardDrive aria-hidden="true" className="h-4 w-4 shrink-0" />}
            value={storageValue}
            subject="Native 提供的 Host 根目录"
            source="用户显式发起的有限元数据扫描"
            sampleTime={formatWallTime(storage?.finishedAtUnixMs ?? null)}
            window={storage ? formatElapsed(storage.elapsedNs) : '未扫描'}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={startStorageScan} disabled={!client || scanActivity.kind === 'scanning' || !documentVisible}>
                <ScanSearch aria-hidden="true" /> 扫描存储
              </Button>
              {scanActivity.kind === 'scanning' ? (
                <Button variant="secondary" size="sm" aria-pressed={scanActivity.cancellation !== 'none'} onClick={requestStorageCancellation} disabled={scanActivity.cancellation === 'requesting' || scanActivity.cancellation === 'requested' || !documentVisible}>
                  请求取消扫描
                </Button>
              ) : null}
              <span role="status" className="min-w-0 text-xs text-muted-foreground">{storageStatus}</span>
            </div>
            {scanActivity.kind === 'scanning' && scanActivity.cancellation === 'requested' ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">已请求取消；这不代表扫描已停止，最终 partial / cancelled 状态以扫描结果为准。</p>
            ) : null}
            {scanActivity.kind === 'scanning' && scanActivity.cancellation === 'not_confirmed' ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">Native 未确认取消请求；扫描结果仍待返回，可再次请求取消。</p>
            ) : null}
            {scanActivity.kind === 'out_of_scope' ? (
              <p role="status" className="mt-2 break-words text-xs text-muted-foreground">扫描 {scanActivity.scanId} 已离开当前注意范围；迟到结果会忽略。取消请求不代表最终扫描状态。</p>
            ) : null}
            {storageFailure ? <p role="alert" className="mt-2 text-xs text-destructive">{storageFailure}</p> : null}
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              logical bytes 下界；不是 allocated bytes、可释放空间或整机总量。只读元数据，不读取文件内容，也不从 UI 传路径。
            </p>
            {storage ? (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>{storage.entriesExamined} 个条目 · {storage.filesExamined} 个文件 · {storage.directoriesExamined} 个目录</p>
                <p>跳过链接 {storage.skippedLinkEntries} · 特殊项 {storage.skippedSpecialEntries}</p>
                <p>logical bytes 精确计数：{storage.logicalBytesCounted}</p>
                {storage.partialReasons.length ? <p>部分原因：{storage.partialReasons.map(storageReasonLabel).join('、')}</p> : null}
                <p>预算：{storage.appliedBudget.maxEntries} 条目 / {storage.appliedBudget.maxFiles} 文件 / {storage.appliedBudget.maxDirectories} 目录 / {formatBytes(storage.appliedBudget.maxLogicalBytes)} / {storage.appliedBudget.maxElapsedMs} ms</p>
                <p>扫描时段：{formatWallTime(storage.startedAtUnixMs)} → {formatWallTime(storage.finishedAtUnixMs)}</p>
                <p>单调耗时：{formatElapsed(storage.elapsedNs)} · 原值 {storage.elapsedNs} ns</p>
                <ul className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                  {storage.areas.map(area => (
                    <li key={area.area} className="flex min-w-0 justify-between gap-2">
                      <span className="min-w-0 break-words">{STORAGE_AREA_LABELS[area.area]}</span>
                      <span className="shrink-0 tabular-nums">{area.fileCount} 文件 · {formatBytes(area.logicalBytesCounted)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </MetricCard>
        </div>
      ) : (
        <section role="status" className="rounded-2xl border border-border-card bg-card p-4 text-sm text-muted-foreground">
          本机 Native 诊断能力未接入。此面板不会通过 HTTP、浏览器存储或模拟 client 读取数据。
        </section>
      )}

      {client && currentSample ? (
        <section className="min-w-0 rounded-2xl border border-border-card bg-card p-3 sm:p-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">采样窗口</h3>
              <p className="mt-1 text-xs text-muted-foreground">最多保留 180 个真样本；每次观察等待上次请求结束后再等 5 秒。</p>
            </div>
            <FieldSelect
              value={trendWindow}
              onValueChange={setTrendWindow}
              options={TREND_WINDOWS}
              label="趋势时间范围"
              title="按 Native 单调采样时间筛选真实样本"
              className="max-w-full"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            当前范围：{windowLabel} · 样本 {visibleSamples.length} / 保留 {history.samples.length}
            {observing ? ' · 正在观察' : observationPaused ? ' · 已暂停' : ' · 未连续观察'}
          </p>
        </section>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          {client ? `读取状态：${sampleStatus === 'loading' ? '请求中' : sampleStatus === 'ready' ? '已取得样本' : sampleStatus === 'error' ? '请求失败' : sampleStatus === 'unsupported' ? '能力未接入' : '等待读取'}` : 'Native 能力未接入'}
        </p>
        <Button ref={detailTriggerRef} variant="ghost" size="sm" onClick={() => { setDetailNotice(null); setDetailsOpen(true); }} disabled={!currentSample}>
          展开本机详情
        </Button>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent
          className="beta-ui max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border-border-card bg-card p-4 text-foreground sm:p-6"
          onCloseAutoFocus={event => { event.preventDefault(); detailTriggerRef.current?.focus({ preventScroll: true }); }}
        >
          <DialogHeader>
            <DialogTitle>运行诊断详情</DialogTitle>
            <DialogDescription>仅展示经过字段白名单校验的本机身份、指标和采样范围。未知字段保持未知，不读取凭据或业务正文。</DialogDescription>
          </DialogHeader>
          {currentSample ? (
            <div className="min-w-0 space-y-4">
              <section className="min-w-0 rounded-xl border border-border-card bg-muted/30 p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">进程身份</h3>
                  <Button variant="outline" size="sm" onClick={() => void copyLocally(JSON.stringify({
                    deviceId: currentSample.deviceId,
                    runtimeId: currentSample.runtimeId,
                    scope: currentSample.process.scope,
                    pid: currentSample.process.identity.pid,
                    collectorLifecycle: currentSample.process.identity.collectorLifecycle,
                  }, null, 2))}>
                    <Clipboard aria-hidden="true" /> 复制本机身份
                  </Button>
                </div>
                <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                  {[
                    ['设备 ID', currentSample.deviceId],
                    ['Runtime ID', currentSample.runtimeId],
                    ['进程 PID', String(currentSample.process.identity.pid)],
                    ['采集生命周期', currentSample.process.identity.collectorLifecycle],
                    ['进程范围', currentSample.process.scope],
                    ['样本时间', formatWallTime(currentSample.process.sampledAtUnixMs)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-lg bg-card p-2">
                      <dt className="text-[11px] text-muted-foreground">{label}</dt>
                      <dd className="mt-1 min-w-0 break-all font-mono text-xs text-foreground"><code className="break-all">{value}</code></dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="min-w-0 rounded-xl border border-border-card bg-muted/30 p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">精确指标</h3>
                  <Button variant="outline" size="sm" onClick={() => void copyLocally(JSON.stringify({
                    sampledAtUnixMs: currentSample.process.sampledAtUnixMs,
                    monotonicElapsedNs: currentSample.process.monotonicElapsedNs,
                    cpu: currentSample.process.cpu,
                    memory: currentSample.process.memory,
                    storage: storageResult ? {
                      scanId: storageResult.scanId,
                      deviceId: storageResult.deviceId,
                      runtimeId: storageResult.runtimeId,
                      report: storageResult.storage,
                    } : null,
                  }, null, 2))}>
                    <Clipboard aria-hidden="true" /> 复制精确指标
                  </Button>
                </div>
                <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                  <DetailMetric label="CPU 累计时间" metric={currentSample.process.cpu.cumulativeTime} />
                  <DetailMetric label="CPU 使用" metric={currentSample.process.cpu.usageCores} />
                  <DetailMetric label="CPU 测量窗口" metric={currentSample.process.cpu.measurementWindow} />
                  <DetailMetric label="进程常驻 / working set" metric={currentSample.process.memory.workingSetBytes} />
                  <DetailMetric label="进程 private bytes" metric={currentSample.process.memory.privateBytes} />
                  <div className="min-w-0 rounded-lg bg-card p-2">
                    <dt className="text-[11px] text-muted-foreground">采集器单调时间</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{currentSample.process.monotonicElapsedNs} ns</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  内存只代表 Native / Host 当前进程。WebView、GPU、设备能耗与 USB 净充电状态均未由此接口测量。
                </p>
              </section>

              <section className="min-w-0 rounded-xl border border-border-card bg-muted/30 p-3">
                <h3 className="text-sm font-semibold">趋势中的精确样本</h3>
                <p className="mt-1 text-xs text-muted-foreground">窗口：{windowLabel}；图形横向位置来自单调纳秒差，原始纳秒仍保留十进制字符串。</p>
                {visibleSamples.length ? (
                  <ol className="mt-2 max-h-48 min-w-0 list-decimal space-y-1 overflow-y-auto overscroll-contain pl-5 text-xs">
                    {visibleSamples.map(sample => (
                      <li key={`${sample.process.identity.collectorLifecycle}-${sample.process.monotonicElapsedNs}`} className="min-w-0 break-all font-mono">
                        {formatWallTime(sample.process.sampledAtUnixMs)} · mono {sample.process.monotonicElapsedNs} ns · CPU {sample.process.cpu.usageCores.availability === 'available' ? `${sample.process.cpu.usageCores.value} cores / ${sample.process.cpu.measurementWindow.value} ns` : `未知（${REASON_LABELS[sample.process.cpu.usageCores.reason]}）`} · memory {sample.process.memory.workingSetBytes.availability === 'available' ? `${sample.process.memory.workingSetBytes.value} bytes` : '未知'}
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-2 text-xs text-muted-foreground">此范围内没有样本。</p>}
              </section>
              {detailNotice ? <p role="status" className="text-xs text-muted-foreground">{detailNotice}</p> : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailMetric({
  label,
  metric,
}: {
  label: string;
  metric: { value: string | number | null; unit: string; availability: 'available' | 'unknown'; reason: DiagnosticReason | null };
}) {
  const value = metric.availability === 'available' ? String(metric.value) : '未知';
  const reason = metric.reason ? REASON_LABELS[metric.reason] : '当前值已测量';
  return (
    <div className="min-w-0 rounded-lg bg-card p-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 break-all font-mono text-xs text-foreground">
        <code className="break-all">{value} {metric.unit}</code>
      </dd>
      <dd className="mt-1 text-[11px] text-muted-foreground">{reason}</dd>
    </div>
  );
}
