import {
  createCompatibleMediaRecorder,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
  getUserMediaWithConstraintFallback,
  type CreateMediaRecorder,
} from '../lib/media/microphone-capture';

export type BetaAudioRecordingPhase =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'stopping'
  | 'awaiting_attachment'
  | 'attaching'
  | 'failed';

export type BetaAudioRecordingLimit = 'duration' | 'bytes' | null;

export interface BetaAudioRecordingSnapshot {
  phase: BetaAudioRecordingPhase;
  profileId: string | null;
  sourceId: string | null;
  durationMs: number;
  byteLength: number;
  mimeType: string | null;
  fileName: string | null;
  partial: boolean;
  limitReached: BetaAudioRecordingLimit;
  error: string | null;
}

export interface BetaAudioRecordingLimits {
  /** Default session bound: 15 minutes. Callers may lower or raise it. */
  maxDurationMs: number;
  /** Default retained source bound: 32 MiB. Callers may lower or raise it. */
  maxBytes: number;
  /** Show a warning before either resource bound is reached. */
  warningRatio: number;
  /** Ask MediaRecorder for short chunks so byte limits are observed promptly. */
  timesliceMs: number;
}

export const DEFAULT_BETA_AUDIO_RECORDING_LIMITS: Readonly<BetaAudioRecordingLimits> = Object.freeze({
  maxDurationMs: 15 * 60 * 1000,
  maxBytes: 32 * 1024 * 1024,
  warningRatio: 0.8,
  timesliceMs: 250,
});

export interface BetaAudioRecordingPlatform {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder?: CreateMediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
  now?: () => number;
  createFile?: (parts: BlobPart[], name: string, options: FilePropertyBag) => File;
  limits?: Partial<BetaAudioRecordingLimits>;
}

export type BetaAudioAttachmentSink = (profileId: string, file: File, sourceId: string) => Promise<void>;

interface RecordingSession {
  generation: number;
  profileId: string;
  sourceId: string;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  mimeType: string | null;
  chunks: Blob[];
  byteLength: number;
  startedAt: number;
  stopRequested: boolean;
  finalized: boolean;
  stopReason: 'user' | 'duration' | 'bytes' | 'recorder_error' | null;
  partial: boolean;
  limitReached: BetaAudioRecordingLimit;
  error: string | null;
  stopPromise: Promise<void> | null;
  resolveStop: (() => void) | null;
}

interface PendingAssembly {
  profileId: string;
  sourceId: string;
  chunks: Blob[];
  durationMs: number;
  byteLength: number;
  mimeType: string;
  partial: boolean;
  limitReached: BetaAudioRecordingLimit;
  error: string | null;
  autoAttach: boolean;
}

interface PendingAudio extends Omit<PendingAssembly, 'chunks'> {
  file: File;
  attachPromise: Promise<void> | null;
  autoAttachAttempted: boolean;
}

const idleSnapshot = (): BetaAudioRecordingSnapshot => ({
  phase: 'idle', profileId: null, sourceId: null, durationMs: 0, byteLength: 0,
  mimeType: null, fileName: null, partial: false, limitReached: null, error: null,
});

function defaultClock(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
}

function describeMicrophoneError(error: unknown): string {
  const name = errorName(error);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '麦克风权限未授予。请允许访问后重试。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有找到可用麦克风。连接设备后可以重试。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '麦克风正被其他应用占用或暂不可用。关闭占用后可以重试。';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '麦克风不支持当前录音设置。请检查设备后重试。';
  }
  if (name === 'MediaRecorderUnavailableError') {
    return '当前环境不支持 MediaRecorder，无法保存原声。';
  }
  if (name === 'MediaDevicesUnavailableError') {
    return '当前环境无法请求麦克风。请在受支持的浏览器或应用窗口中重试。';
  }
  if (error instanceof Error && error.message) return `录音未能开始：${error.message}`;
  return '录音未能开始。检查麦克风后重试。';
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* Continue releasing the remaining tracks. */ }
  }
}

function stableRecordingSourceId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function uniqueRecordingName(extension: string, sourceId: string): string {
  return `exomind-audio-${sourceId}.${extension}`;
}

function extensionForMimeType(mimeType: string): string {
  if (/\bmp4\b|\bm4a\b/i.test(mimeType)) return 'm4a';
  if (/\bwebm\b/i.test(mimeType)) return 'webm';
  if (/\bogg\b|\bopus\b/i.test(mimeType)) return 'ogg';
  return 'audio';
}

/**
 * Owns one profile-bound MediaRecorder session independently of React views.
 * Unsubscribing a view only stops observation; callers dispose this controller
 * at the owning device workspace's actual exit boundary.
 */
export class BetaAudioRecordingController {
  private readonly listeners = new Set<() => void>();
  private readonly limitsValue: Readonly<BetaAudioRecordingLimits>;
  private readonly clock: () => number;
  private snapshotValue = idleSnapshot();
  private generation = 0;
  private session: RecordingSession | null = null;
  private pending: PendingAudio | null = null;
  private pendingAssembly: PendingAssembly | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private attachmentSink: BetaAudioAttachmentSink | null = null;

  constructor(private readonly platform: BetaAudioRecordingPlatform = {}) {
    this.clock = platform.now ?? defaultClock;
    this.limitsValue = Object.freeze({ ...DEFAULT_BETA_AUDIO_RECORDING_LIMITS, ...platform.limits });
    if (!Number.isFinite(this.limitsValue.maxDurationMs) || this.limitsValue.maxDurationMs <= 0
      || !Number.isSafeInteger(this.limitsValue.maxBytes) || this.limitsValue.maxBytes <= 0
      || !Number.isFinite(this.limitsValue.warningRatio) || this.limitsValue.warningRatio <= 0 || this.limitsValue.warningRatio >= 1
      || !Number.isSafeInteger(this.limitsValue.timesliceMs) || this.limitsValue.timesliceMs <= 0) {
      throw new RangeError('录音时长、字节、预警比例和分块间隔必须是有效正数');
    }
  }

  readonly snapshot = (): BetaAudioRecordingSnapshot => this.snapshotValue;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get limits(): Readonly<BetaAudioRecordingLimits> { return this.limitsValue; }

  /** Device workspace supplies the current profile owner; the controller keeps the sink across hidden views. */
  setAttachmentSink(sink: BetaAudioAttachmentSink | null): void {
    this.attachmentSink = sink;
    const pending = this.pending;
    if (sink && pending?.autoAttach && !pending.autoAttachAttempted) {
      pending.autoAttachAttempted = true;
      void this.accept(pending.profileId, sink).catch(() => {});
    }
  }

  /** Explicit user action only. Construction and subscription never ask for a microphone. */
  async start(profileId: string): Promise<void> {
    if (this.disposed) throw new Error('录音控制器已关闭');
    if (!profileId.trim()) throw new Error('请先选择档案再录音');
    if (this.session || this.pending || this.pendingAssembly) throw new Error('当前原声片段尚未处理完成');

    const session: RecordingSession = {
      generation: ++this.generation,
      profileId,
      sourceId: stableRecordingSourceId(),
      stream: null,
      recorder: null,
      mimeType: null,
      chunks: [],
      byteLength: 0,
      startedAt: 0,
      stopRequested: false,
      finalized: false,
      stopReason: null,
      partial: false,
      limitReached: null,
      error: null,
      stopPromise: null,
      resolveStop: null,
    };
    this.session = session;
    this.publish({ ...idleSnapshot(), phase: 'requesting_permission', profileId, sourceId: session.sourceId });

    try {
      if (!this.platform.createRecorder && typeof MediaRecorder === 'undefined') {
        const unsupported = new Error('MediaRecorder is unavailable');
        unsupported.name = 'MediaRecorderUnavailableError';
        throw unsupported;
      }

      const getUserMedia = this.resolveGetUserMedia();
      const stream = await getUserMediaWithConstraintFallback(
        getUserMedia,
        { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS },
      );
      if (!this.isCurrent(session)) {
        stopTracks(stream);
        return;
      }
      session.stream = stream;

      const { recorder, mimeType } = createCompatibleMediaRecorder(stream, {
        createRecorder: this.platform.createRecorder,
        isTypeSupported: this.platform.isTypeSupported,
      });
      session.recorder = recorder;
      session.mimeType = mimeType || recorder.mimeType || null;
      recorder.ondataavailable = event => this.collect(session, event.data);
      recorder.onerror = event => this.onRecorderError(session, event);
      recorder.onstop = () => {
        if (!session.stopRequested && this.isCurrent(session)) {
          session.partial = true;
          session.error = session.error ?? '录音器在用户停止前结束；已保留收到的原声片段，完整性未知。';
        }
        this.finish(session);
      };
      recorder.start(this.limitsValue.timesliceMs);
      session.startedAt = this.clock();
      this.publish(this.sessionSnapshot(session, 'recording'));
      this.startTicker(session);
    } catch (error) {
      if (!this.isCurrent(session)) return;
      this.clearTicker();
      this.detachRecorder(session.recorder);
      stopTracks(session.stream);
      session.chunks.length = 0;
      this.session = null;
      this.publish({ ...idleSnapshot(), phase: 'failed', profileId, error: describeMicrophoneError(error) });
    }
  }

  /** Cancel a pending permission prompt. A late stream is stopped by start(). */
  cancelStartup(profileId: string): boolean {
    const session = this.session;
    if (!session || session.profileId !== profileId || this.snapshotValue.phase !== 'requesting_permission') return false;
    this.cancelSession(session);
    return true;
  }

  /** Stop and finalize the recorder. The final dataavailable event is retained before onstop. */
  stop(): Promise<void> {
    const session = this.session;
    if (!session) return Promise.resolve();
    if (this.snapshotValue.phase === 'stopping') return session.stopPromise ?? Promise.resolve();
    if (this.snapshotValue.phase !== 'recording') return Promise.resolve();
    this.requestStop(session, 'user');
    return session.stopPromise ?? Promise.resolve();
  }

  /** Retry File construction if the runtime rejected the first packaging attempt. */
  retryFileAssembly(): boolean {
    if (!this.pendingAssembly || this.disposed) return false;
    return this.assemblePending(this.pendingAssembly);
  }

  /** Handoff to Beta's local attachment pipeline; rejection keeps the exact File for retry. */
  accept(profileId: string, sink: BetaAudioAttachmentSink): Promise<void> {
    const pending = this.pending;
    if (!pending) return Promise.reject(new Error('当前没有待加入的原声附件'));
    if (profileId !== pending.profileId) return Promise.reject(new Error(`这段原声属于档案 ${pending.profileId}，请切回该档案后再加入附件`));
    if (pending.attachPromise) return pending.attachPromise;

    this.publish(this.pendingSnapshot(pending, 'attaching', null));
    let operation!: Promise<void>;
    operation = (async () => {
      try {
        await sink(pending.profileId, pending.file, pending.sourceId);
        if (this.pending !== pending || this.disposed) return;
        this.pending = null;
        this.publish(idleSnapshot());
      } catch (error) {
        if (this.pending === pending && !this.disposed) {
          const message = error instanceof Error && error.message
            ? error.message
            : '附件管线尚未接纳原声；片段仍保留，可以重试或明确放弃。';
          this.publish(this.pendingSnapshot(pending, 'awaiting_attachment', message));
        }
        throw error;
      } finally {
        if (pending.attachPromise === operation) pending.attachPromise = null;
      }
    })();
    pending.attachPromise = operation;
    return operation;
  }

  /** Explicitly discard this profile's live or stopped recording. */
  discard(profileId: string): boolean {
    if (this.session?.profileId === profileId) {
      this.cancelSession(this.session);
      return true;
    }
    if (this.pending?.profileId === profileId) {
      if (this.pending.attachPromise) return false;
      this.pending = null;
      this.publish(idleSnapshot());
      return true;
    }
    if (this.pendingAssembly?.profileId === profileId) {
      this.pendingAssembly.chunks.length = 0;
      this.pendingAssembly = null;
      this.publish({ ...idleSnapshot(), phase: 'idle' });
      return true;
    }
    return false;
  }

  /** Application/device workspace exit: stop tracks and release local chunks without global cleanup. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.clearTicker();
    const session = this.session;
    this.session = null;
    if (session) this.releaseSession(session);
    if (this.pendingAssembly) this.pendingAssembly.chunks.length = 0;
    this.pendingAssembly = null;
    this.pending = null;
    this.attachmentSink = null;
    this.listeners.clear();
  }

  private resolveGetUserMedia(): (constraints: MediaStreamConstraints) => Promise<MediaStream> {
    if (this.platform.getUserMedia) return this.platform.getUserMedia;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const unsupported = new Error('navigator.mediaDevices.getUserMedia is unavailable');
      unsupported.name = 'MediaDevicesUnavailableError';
      throw unsupported;
    }
    return constraints => navigator.mediaDevices.getUserMedia(constraints);
  }

  private isCurrent(session: RecordingSession): boolean {
    return !this.disposed && this.session === session && session.generation === this.generation;
  }

  private publish(snapshot: BetaAudioRecordingSnapshot): void {
    if (this.disposed) return;
    this.snapshotValue = Object.freeze(snapshot);
    for (const listener of Array.from(this.listeners)) listener();
  }

  private sessionSnapshot(session: RecordingSession, phase: BetaAudioRecordingPhase): BetaAudioRecordingSnapshot {
    return {
      phase,
      profileId: session.profileId,
      sourceId: session.sourceId,
      durationMs: Math.max(0, Math.floor(this.clock() - session.startedAt)),
      byteLength: session.byteLength,
      mimeType: session.mimeType,
      fileName: null,
      partial: session.partial,
      limitReached: session.limitReached,
      error: session.error,
    };
  }

  private pendingSnapshot(pending: PendingAudio, phase: 'awaiting_attachment' | 'attaching', error: string | null): BetaAudioRecordingSnapshot {
    return {
      phase,
      profileId: pending.profileId,
      sourceId: pending.sourceId,
      durationMs: pending.durationMs,
      byteLength: pending.byteLength,
      mimeType: pending.mimeType,
      fileName: pending.file.name,
      partial: pending.partial,
      limitReached: pending.limitReached,
      error,
    };
  }

  private startTicker(session: RecordingSession): void {
    this.clearTicker();
    this.ticker = setInterval(() => {
      if (!this.isCurrent(session) || this.snapshotValue.phase !== 'recording') return;
      const elapsed = Math.max(0, Math.floor(this.clock() - session.startedAt));
      if (elapsed >= this.limitsValue.maxDurationMs) {
        this.requestStop(session, 'duration');
        return;
      }
      if (Math.floor(elapsed / 1000) !== Math.floor(this.snapshotValue.durationMs / 1000)) {
        this.publish(this.sessionSnapshot(session, 'recording'));
      }
    }, 250);
  }

  private clearTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  private collect(session: RecordingSession, chunk: Blob): void {
    if (!this.isCurrent(session) || session.finalized || chunk.size <= 0) return;
    if (!session.mimeType && chunk.type) session.mimeType = chunk.type;
    const remaining = Math.max(0, this.limitsValue.maxBytes - session.byteLength);
    if (chunk.size > remaining) {
      if (remaining > 0) session.chunks.push(chunk.slice(0, remaining, chunk.type || session.mimeType || ''));
      session.byteLength += remaining;
      session.partial = true;
      session.limitReached = 'bytes';
      this.requestStop(session, 'bytes');
      return;
    }
    session.chunks.push(chunk);
    session.byteLength += chunk.size;
    if (session.byteLength >= this.limitsValue.maxBytes) {
      session.partial = true;
      session.limitReached = 'bytes';
      this.requestStop(session, 'bytes');
      return;
    }
    if (this.clock() - session.startedAt >= this.limitsValue.maxDurationMs) {
      session.limitReached = 'duration';
      this.requestStop(session, 'duration');
      return;
    }
    if (this.snapshotValue.phase === 'recording') this.publish(this.sessionSnapshot(session, 'recording'));
  }

  private onRecorderError(session: RecordingSession, event: Event): void {
    if (!this.isCurrent(session)) return;
    const message = typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent && event.message
      ? event.message
      : 'MediaRecorder 编码异常';
    session.partial = true;
    session.error = `录音编码遇到问题，已保留收到的片段：${message}`;
    this.requestStop(session, 'recorder_error');
  }

  private requestStop(session: RecordingSession, reason: NonNullable<RecordingSession['stopReason']>): void {
    if (!this.isCurrent(session) || session.stopRequested) return;
    session.stopRequested = true;
    session.stopReason = reason;
    if (reason === 'duration') session.limitReached = 'duration';
    if (reason === 'bytes') { session.limitReached = 'bytes'; session.partial = true; }
    if (reason === 'recorder_error') session.partial = true;
    this.clearTicker();
    session.stopPromise = new Promise(resolve => { session.resolveStop = resolve; });
    this.publish(this.sessionSnapshot(session, 'stopping'));
    const recorder = session.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.finish(session);
      return;
    }
    try {
      recorder.stop();
    } catch (error) {
      session.partial = true;
      session.error = session.error ?? `停止录音时遇到问题，已保留收到的片段：${error instanceof Error ? error.message : String(error)}`;
      this.finish(session);
    }
  }

  private finish(session: RecordingSession): void {
    if (session.finalized) return;
    session.finalized = true;
    this.clearTicker();
    this.detachRecorder(session.recorder);
    stopTracks(session.stream);
    session.recorder = null;
    session.stream = null;

    if (!this.isCurrent(session)) {
      session.chunks.length = 0;
      session.resolveStop?.();
      return;
    }
    this.session = null;
    const durationMs = Math.max(0, Math.floor(this.clock() - session.startedAt));
    const mimeType = session.mimeType || session.chunks.find(chunk => chunk.type)?.type || 'application/octet-stream';
    if (!session.chunks.length || session.byteLength === 0) {
      session.chunks.length = 0;
      this.publish({ ...idleSnapshot(), phase: 'failed', profileId: session.profileId,
        error: session.error ?? '录音已停止，但没有收到可保存的原声数据。可以重新录音。' });
      session.resolveStop?.();
      return;
    }

    this.assemblePending({
      profileId: session.profileId,
      sourceId: session.sourceId,
      chunks: session.chunks,
      durationMs,
      byteLength: session.byteLength,
      mimeType,
      partial: session.partial,
      limitReached: session.limitReached,
      error: session.error,
      autoAttach: session.stopReason === 'user',
    });
    session.resolveStop?.();
  }

  private assemblePending(assembly: PendingAssembly): boolean {
    if (this.disposed) return false;
    const extension = extensionForMimeType(assembly.mimeType);
    const fileName = uniqueRecordingName(`${assembly.partial ? 'partial-' : ''}${extension}`, assembly.sourceId);
    try {
      const createFile = this.platform.createFile ?? ((parts, name, options) => new File(parts, name, options));
      const file = createFile(assembly.chunks, fileName, { type: assembly.mimeType, lastModified: Date.now() });
      if (file.size !== assembly.byteLength) throw new Error('保存后的文件长度与已收集字节不一致');
      this.pendingAssembly = null;
      this.pending = {
        profileId: assembly.profileId,
        sourceId: assembly.sourceId,
        durationMs: assembly.durationMs,
        byteLength: assembly.byteLength,
        mimeType: assembly.mimeType,
        partial: assembly.partial,
        limitReached: assembly.limitReached,
        error: assembly.error,
        file,
        attachPromise: null,
        autoAttach: assembly.autoAttach,
        autoAttachAttempted: false,
      };
      this.publish(this.pendingSnapshot(this.pending, 'awaiting_attachment', assembly.error));
      if (this.pending.autoAttach && this.attachmentSink) {
        this.pending.autoAttachAttempted = true;
        void this.accept(this.pending.profileId, this.attachmentSink).catch(() => {});
      }
      return true;
    } catch (error) {
      this.pendingAssembly = { ...assembly };
      this.publish({
        phase: 'failed', profileId: assembly.profileId, sourceId: assembly.sourceId, durationMs: assembly.durationMs,
        byteLength: assembly.byteLength, mimeType: assembly.mimeType, fileName: null,
        partial: assembly.partial, limitReached: assembly.limitReached,
        error: `原声片段仍留在录音控制器，但未能封装成附件：${error instanceof Error ? error.message : String(error)}。可以重试封装或明确放弃。`,
      });
      return false;
    }
  }

  private cancelSession(session: RecordingSession): void {
    ++this.generation;
    this.session = null;
    this.clearTicker();
    this.releaseSession(session);
    this.publish(idleSnapshot());
  }

  private releaseSession(session: RecordingSession): void {
    this.detachRecorder(session.recorder);
    if (session.recorder && session.recorder.state !== 'inactive') {
      try { session.recorder.stop(); } catch { /* Tracks are still stopped below. */ }
    }
    stopTracks(session.stream);
    session.stream = null;
    session.recorder = null;
    session.chunks.length = 0;
    session.resolveStop?.();
  }

  private detachRecorder(recorder: MediaRecorder | null): void {
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
  }
}
