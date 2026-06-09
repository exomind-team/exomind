import { log } from "@/lib/logger";

const PTY_ARROW_SEQUENCE_BY_KEY: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
};

const PTY_INPUT_BATCH_WINDOW_MS = 12;
const PTY_INPUT_ACK_TIMEOUT_MS = 1_200;
const PTY_RESIZE_ACK_TIMEOUT_MS = 500;
const PTY_INPUT_READY_TIMEOUT_MS = 1_500;
const PTY_INPUT_IDLE_CLOSE_MS = 15_000;
const PTY_INPUT_MAX_CHUNK_BYTES = 1_024;
export const PTY_WS_PROTOCOL_VERSION = 3;

type PtyInputTransportPhase = "idle" | "connecting" | "ready" | "error";

interface PtyWsReadyMessage {
  type: "ready";
  protocol_version: number;
  read_only?: boolean;
  capabilities: {
    input_ack?: boolean;
    resize?: boolean;
    resize_ack?: boolean;
    output_stream?: boolean;
    output_cursor?: boolean;
  };
}

interface PtyWsAckMessage {
  type: "ack";
  input_seq: number;
}

interface PtyWsPongMessage {
  type: "pong";
  nonce?: number | null;
}

interface PtyWsResizeAckMessage {
  type: "resize_ack";
  resize_seq: number;
}

interface PtyWsErrorMessage {
  type: "error";
  code?: string;
  message?: string;
  input_seq?: number;
  resize_seq?: number;
}

type PtyWsServerMessage =
  | PtyWsReadyMessage
  | PtyWsAckMessage
  | PtyWsResizeAckMessage
  | PtyWsPongMessage
  | PtyWsErrorMessage;

interface PtyInputBatch {
  inputSeq: number;
  data: string;
  timerId: ReturnType<typeof setTimeout> | null;
  resolvers: Array<(value: PtyInputTransportResponse) => void>;
  rejecters: Array<(reason?: unknown) => void>;
}

interface PtyPendingAck {
  timerId: ReturnType<typeof setTimeout>;
  resolvers: Array<(value: PtyInputTransportResponse) => void>;
  rejecters: Array<(reason?: unknown) => void>;
}

type PtyTransportListener = (snapshot: PtyInputTransportSnapshot) => void;

export interface PtyInputTarget {
  rtBaseUrl: string;
  ptyId: string;
  authToken?: string;
}

export interface PtyInputTransportResponse {
  ok: boolean;
  status: number;
  statusText?: string;
}

export interface PtyInputTransportSnapshot {
  phase: PtyInputTransportPhase;
  errorMessage: string | null;
  errorCode: string | null;
  readOnly: boolean;
}

export interface PtyInputTransportLease {
  getSnapshot: () => PtyInputTransportSnapshot;
  retry: () => void;
  release: () => void;
  subscribe: (listener: PtyTransportListener) => () => void;
}

const transportPool = new Map<string, PtyInputWsTransport>();

function encodeTextAsBase64(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function splitTextIntoTransportChunks(text: string): string[] {
  if (!text) {
    return [];
  }

  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let currentChunk = "";
  let currentChunkBytes = 0;

  for (const char of Array.from(text)) {
    const charBytes = encoder.encode(char).length;
    if (
      currentChunk &&
      currentChunkBytes + charBytes > PTY_INPUT_MAX_CHUNK_BYTES
    ) {
      chunks.push(currentChunk);
      currentChunk = char;
      currentChunkBytes = charBytes;
      continue;
    }

    currentChunk += char;
    currentChunkBytes += charBytes;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function normalizeAuthToken(authToken?: string): string {
  return authToken?.trim() ?? "";
}

function buildTransportKey(target: PtyInputTarget): string {
  return `${target.rtBaseUrl}|${target.ptyId}|${normalizeAuthToken(target.authToken)}`;
}

function buildPtyWebSocketUrl(target: PtyInputTarget): string {
  const url = new URL(target.rtBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/pty/${encodeURIComponent(target.ptyId)}/ws`;
  url.search = "";
  url.searchParams.set("mode", "input");

  const token = normalizeAuthToken(target.authToken);
  if (token) {
    url.searchParams.set("token", token);
  }

  return url.toString();
}

function describePtyTarget(target: PtyInputTarget): string {
  return `pty=${target.ptyId}`;
}

function resolveArrowModifierCode(shortcut: string): number | null {
  if (shortcut.startsWith("Alt+Shift+")) {
    return 4;
  }
  if (shortcut.startsWith("Alt+")) {
    return 3;
  }
  return null;
}

function createOkResponse(status = 204): PtyInputTransportResponse {
  return { ok: true, status };
}

function createErrorResponse(
  status: number,
  statusText: string,
): PtyInputTransportResponse {
  return { ok: false, status, statusText };
}

function createTransportError(message: string): Error {
  return new Error(message);
}

function shouldFlushImmediately(text: string): boolean {
  return (
    text.includes("\r") ||
    text.includes("\n") ||
    text.includes("\u0003") ||
    text.includes("\u001b")
  );
}

function isFatalServerError(code: string | undefined): boolean {
  return (
    code === "not_found" ||
    code === "unauthorized" ||
    code === "forbidden" ||
    code === "transport_error"
  );
}

function mapServerErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "transport_error":
      return 500;
    default:
      return 500;
  }
}

function formatInitialTransportFailureMessage(): string {
  return "终端输入通道不可用：当前 RT 可能还不支持 PTY WebSocket，请升级 Runtime 后重试。";
}

function formatDisconnectedTransportMessage(): string {
  return "终端输入通道已断开，当前仅保留只读输出；请手动重试输入通道。";
}

function formatProtocolMismatchMessage(): string {
  return "终端输入通道不可用：当前 RT 的 PTY WebSocket 协议版本不兼容，请升级 Runtime 后重试。";
}

function formatReadOnlyTransportMessage(): string {
  return "终端输入通道不可用：当前 PTY 仅保留只读输出；请重连或恢复会话后再试。";
}

export function isPtyInputTransportPtyUnavailable(
  snapshot: PtyInputTransportSnapshot,
): boolean {
  return snapshot.phase === "error" && snapshot.errorCode === "not_found";
}

function resolveReadyMessageCompatibilityError(
  message: PtyWsReadyMessage,
): string | null {
  if (message.protocol_version !== PTY_WS_PROTOCOL_VERSION) {
    return formatProtocolMismatchMessage();
  }

  if (
    message.capabilities.output_stream !== true ||
    message.capabilities.output_cursor !== true
  ) {
    return formatProtocolMismatchMessage();
  }

  if (message.read_only === true) {
    return formatReadOnlyTransportMessage();
  }

  if (message.capabilities.input_ack !== true) {
    return formatProtocolMismatchMessage();
  }

  if (
    message.capabilities.resize !== true ||
    message.capabilities.resize_ack !== true
  ) {
    return formatProtocolMismatchMessage();
  }

  return null;
}

function getWindowTimeoutApi() {
  if (typeof window !== "undefined") {
    return window;
  }
  return globalThis;
}

class PtyInputWsTransport {
  private readonly poolKey: string;
  private readonly target: PtyInputTarget;
  private ws: WebSocket | null = null;
  private listeners = new Set<PtyTransportListener>();
  private snapshot: PtyInputTransportSnapshot = {
    phase: "idle",
    errorMessage: null,
    errorCode: null,
    readOnly: false,
  };
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((reason?: unknown) => void) | null = null;
  private readyTimerId: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimerId: ReturnType<typeof setTimeout> | null = null;
  private nextInputSeq = 1;
  private nextResizeSeq = 1;
  private currentBatch: PtyInputBatch | null = null;
  private pendingAcks = new Map<number, PtyPendingAck>();
  private pendingResizeAcks = new Map<number, PtyPendingAck>();
  private retainCount = 0;
  private readyReceivedForCurrentConnection = false;

  constructor(target: PtyInputTarget) {
    this.target = {
      rtBaseUrl: target.rtBaseUrl,
      ptyId: target.ptyId,
      authToken: normalizeAuthToken(target.authToken) || undefined,
    };
    this.poolKey = buildTransportKey(this.target);
  }

  getSnapshot(): PtyInputTransportSnapshot {
    return this.snapshot;
  }

  retain(): void {
    this.retainCount += 1;
    this.clearIdleCloseTimer();
    void this.ensureReady().catch(() => {
      // Error state is tracked in snapshot; callers render retry explicitly.
    });
  }

  release(): void {
    this.retainCount = Math.max(0, this.retainCount - 1);
    this.scheduleIdleClose();
  }

  subscribe(listener: PtyTransportListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  retry(): void {
    log.info(
      `[PtyInputTransport] retry requested for ${describePtyTarget(this.target)}`,
    );
    this.resetConnection({ keepErrorState: false });
    void this.ensureReady().catch(() => {
      // Snapshot already carries failure details.
    });
  }

  async sendText(text: string): Promise<PtyInputTransportResponse> {
    if (!text) {
      return createOkResponse();
    }

    await this.ensureReady();
    const chunks = splitTextIntoTransportChunks(text);
    let lastResponse = createOkResponse();
    for (const chunk of chunks) {
      lastResponse = await this.enqueueInput(chunk);
      if (!lastResponse.ok) {
        return lastResponse;
      }
    }
    return lastResponse;
  }

  async sendResize(
    rows: number,
    cols: number,
  ): Promise<PtyInputTransportResponse> {
    await this.ensureReady();
    if (!this.ws || this.snapshot.phase !== "ready") {
      throw createTransportError(
        this.snapshot.errorMessage ?? formatInitialTransportFailureMessage(),
      );
    }

    return new Promise<PtyInputTransportResponse>((resolve, reject) => {
      const resizeSeq = this.nextResizeSeq;
      this.nextResizeSeq += 1;
      const timeoutApi = getWindowTimeoutApi();

      try {
        this.ws!.send(
          JSON.stringify({
            type: "resize",
            resize_seq: resizeSeq,
            rows,
            cols,
          }),
        );
      } catch {
        const error = createTransportError(
          formatDisconnectedTransportMessage(),
        );
        reject(error);
        this.failTransport(formatDisconnectedTransportMessage());
        return;
      }

      const ackTimerId = timeoutApi.setTimeout(() => {
        this.pendingResizeAcks.delete(resizeSeq);
        const timeoutMessage =
          "终端尺寸同步超时；终端将保持当前尺寸，请稍后重试。";
        log.warn(
          `[PtyInputTransport] resize ack timed out for ${describePtyTarget(this.target)} resize_seq=${resizeSeq}`,
        );
        resolve(createErrorResponse(504, timeoutMessage));
        this.scheduleIdleClose();
      }, PTY_RESIZE_ACK_TIMEOUT_MS);

      this.pendingResizeAcks.set(resizeSeq, {
        timerId: ackTimerId,
        resolvers: [resolve],
        rejecters: [reject],
      });
    });
  }

  destroyForTests(): void {
    this.resetConnection({ keepErrorState: false, nextPhase: "idle" });
    transportPool.delete(this.poolKey);
  }

  private setSnapshot(next: PtyInputTransportSnapshot): void {
    if (
      this.snapshot.phase === next.phase &&
      this.snapshot.errorMessage === next.errorMessage &&
      this.snapshot.errorCode === next.errorCode &&
      this.snapshot.readOnly === next.readOnly
    ) {
      return;
    }

    this.snapshot = next;
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private resetConnection(
    options: {
      keepErrorState?: boolean;
      nextPhase?: PtyInputTransportPhase;
    } = {},
  ): void {
    const timeoutApi = getWindowTimeoutApi();

    if (this.readyTimerId != null) {
      timeoutApi.clearTimeout(this.readyTimerId);
      this.readyTimerId = null;
    }

    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;

    if (this.currentBatch?.timerId != null) {
      timeoutApi.clearTimeout(this.currentBatch.timerId);
      this.currentBatch.timerId = null;
    }
    this.currentBatch = null;

    this.pendingAcks.forEach((pendingAck) => {
      timeoutApi.clearTimeout(pendingAck.timerId);
    });
    this.pendingAcks.clear();

    this.pendingResizeAcks.forEach((pendingResizeAck) => {
      timeoutApi.clearTimeout(pendingResizeAck.timerId);
    });
    this.pendingResizeAcks.clear();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }

    if (!options.keepErrorState) {
      this.setSnapshot({
        phase: options.nextPhase ?? "idle",
        errorMessage: null,
        errorCode: null,
        readOnly: false,
      });
    }
  }

  private clearIdleCloseTimer(): void {
    const timeoutApi = getWindowTimeoutApi();
    if (this.idleCloseTimerId != null) {
      timeoutApi.clearTimeout(this.idleCloseTimerId);
      this.idleCloseTimerId = null;
    }
  }

  private scheduleIdleClose(): void {
    if (
      this.retainCount > 0 ||
      this.connectPromise ||
      this.currentBatch ||
      this.pendingAcks.size > 0 ||
      this.pendingResizeAcks.size > 0
    ) {
      return;
    }

    this.clearIdleCloseTimer();
    const timeoutApi = getWindowTimeoutApi();
    this.idleCloseTimerId = timeoutApi.setTimeout(() => {
      if (
        this.retainCount > 0 ||
        this.connectPromise ||
        this.currentBatch ||
        this.pendingAcks.size > 0 ||
        this.pendingResizeAcks.size > 0
      ) {
        return;
      }
      log.info(
        `[PtyInputTransport] closing idle transport for ${describePtyTarget(this.target)}`,
      );
      this.resetConnection({ keepErrorState: false, nextPhase: "idle" });
      transportPool.delete(this.poolKey);
    }, PTY_INPUT_IDLE_CLOSE_MS);
  }

  private async ensureReady(): Promise<void> {
    if (this.snapshot.phase === "error") {
      throw createTransportError(
        this.snapshot.errorMessage ?? formatInitialTransportFailureMessage(),
      );
    }

    if (
      this.snapshot.phase === "ready" &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const websocketUrl = buildPtyWebSocketUrl(this.target);
    log.info(
      `[PtyInputTransport] opening PTY input websocket for ${describePtyTarget(this.target)} via ${websocketUrl}`,
    );
    const ws = new WebSocket(websocketUrl);
    this.ws = ws;
    this.readyReceivedForCurrentConnection = false;
    this.clearIdleCloseTimer();
    this.setSnapshot({
      phase: "connecting",
      errorMessage: null,
      errorCode: null,
      readOnly: false,
    });

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });

    const timeoutApi = getWindowTimeoutApi();
    this.readyTimerId = timeoutApi.setTimeout(() => {
      if (this.snapshot.phase !== "ready") {
        log.warn(
          `[PtyInputTransport] PTY input websocket timed out before ready for ${describePtyTarget(this.target)}`,
        );
        this.failTransport(formatInitialTransportFailureMessage(), {
          rejectAsIndeterminate: false,
        });
      }
    }, PTY_INPUT_READY_TIMEOUT_MS);

    ws.onopen = () => {
      log.info(
        `[PtyInputTransport] PTY input websocket opened for ${describePtyTarget(this.target)}`,
      );
      // Wait for explicit ready frame before entering interactive state.
    };

    ws.onmessage = (event) => {
      this.handleServerMessage(event.data);
    };

    ws.onerror = () => {
      // Browser WebSocket errors do not expose actionable detail; onclose/timeout finalizes state.
    };

    ws.onclose = () => {
      const message = this.readyReceivedForCurrentConnection
        ? formatDisconnectedTransportMessage()
        : formatInitialTransportFailureMessage();
      log.warn(
        `[PtyInputTransport] PTY input websocket closed for ${describePtyTarget(this.target)}${this.readyReceivedForCurrentConnection ? " after ready" : " before ready"}`,
      );
      this.failTransport(message, {
        rejectAsIndeterminate: this.readyReceivedForCurrentConnection,
      });
    };

    return this.connectPromise;
  }

  private handleServerMessage(rawData: unknown): void {
    if (typeof rawData !== "string") {
      return;
    }

    let message: PtyWsServerMessage;
    try {
      message = JSON.parse(rawData) as PtyWsServerMessage;
    } catch {
      log.error(
        `[PtyInputTransport] PTY input websocket returned invalid JSON for ${describePtyTarget(this.target)}`,
      );
      this.failTransport("终端输入通道返回了无法识别的消息。");
      return;
    }

    if (message.type === "ready") {
      const compatibilityError = resolveReadyMessageCompatibilityError(message);
      if (compatibilityError) {
        this.failTransport(compatibilityError, {
          rejectAsIndeterminate: false,
        });
        return;
      }

      this.readyReceivedForCurrentConnection = true;
      const timeoutApi = getWindowTimeoutApi();
      if (this.readyTimerId != null) {
        timeoutApi.clearTimeout(this.readyTimerId);
        this.readyTimerId = null;
      }
      this.setSnapshot({
        phase: "ready",
        errorMessage: null,
        errorCode: null,
        readOnly: false,
      });
      log.info(
        `[PtyInputTransport] PTY input websocket ready for ${describePtyTarget(this.target)}`,
      );
      this.resolveConnect?.();
      this.connectPromise = null;
      this.resolveConnect = null;
      this.rejectConnect = null;
      this.scheduleIdleClose();
      return;
    }

    if (message.type === "ack") {
      const pendingAck = this.pendingAcks.get(message.input_seq);
      if (!pendingAck) {
        return;
      }
      const timeoutApi = getWindowTimeoutApi();
      timeoutApi.clearTimeout(pendingAck.timerId);
      this.pendingAcks.delete(message.input_seq);
      pendingAck.resolvers.forEach((resolve) => resolve(createOkResponse()));
      this.scheduleIdleClose();
      return;
    }

    if (message.type === "resize_ack") {
      const pendingResizeAck = this.pendingResizeAcks.get(message.resize_seq);
      if (!pendingResizeAck) {
        return;
      }
      const timeoutApi = getWindowTimeoutApi();
      timeoutApi.clearTimeout(pendingResizeAck.timerId);
      this.pendingResizeAcks.delete(message.resize_seq);
      pendingResizeAck.resolvers.forEach((resolve) =>
        resolve(createOkResponse()),
      );
      this.scheduleIdleClose();
      return;
    }

    if (message.type === "error") {
      const errorMessage = message.message?.trim() || "发送到终端失败";
      log.warn(
        `[PtyInputTransport] server error for ${describePtyTarget(this.target)}: ${message.code ?? "unknown"} ${errorMessage}`,
      );
      if (typeof message.input_seq === "number") {
        const pendingAck = this.pendingAcks.get(message.input_seq);
        if (pendingAck) {
          const timeoutApi = getWindowTimeoutApi();
          timeoutApi.clearTimeout(pendingAck.timerId);
          this.pendingAcks.delete(message.input_seq);
          const response = createErrorResponse(
            mapServerErrorCodeToStatus(message.code),
            errorMessage,
          );
          pendingAck.resolvers.forEach((resolve) => resolve(response));
        }
      }

      if (typeof message.resize_seq === "number") {
        const pendingResizeAck = this.pendingResizeAcks.get(message.resize_seq);
        if (pendingResizeAck) {
          const timeoutApi = getWindowTimeoutApi();
          timeoutApi.clearTimeout(pendingResizeAck.timerId);
          this.pendingResizeAcks.delete(message.resize_seq);
          const response = createErrorResponse(
            mapServerErrorCodeToStatus(message.code),
            errorMessage,
          );
          pendingResizeAck.resolvers.forEach((resolve) => resolve(response));
        }
      }

      if (isFatalServerError(message.code)) {
        this.failTransport(errorMessage, {
          rejectAsIndeterminate: false,
          errorCode: message.code ?? null,
        });
        return;
      }

      this.scheduleIdleClose();
    }
  }

  private enqueueInput(text: string): Promise<PtyInputTransportResponse> {
    return new Promise<PtyInputTransportResponse>((resolve, reject) => {
      const timeoutApi = getWindowTimeoutApi();

      if (!this.currentBatch) {
        this.currentBatch = {
          inputSeq: this.nextInputSeq,
          data: "",
          timerId: null,
          resolvers: [],
          rejecters: [],
        };
        this.nextInputSeq += 1;
      }

      this.currentBatch.data += text;
      this.currentBatch.resolvers.push(resolve);
      this.currentBatch.rejecters.push(reject);

      if (shouldFlushImmediately(text)) {
        this.flushCurrentBatch();
        return;
      }

      if (this.currentBatch.timerId == null) {
        this.currentBatch.timerId = timeoutApi.setTimeout(() => {
          this.flushCurrentBatch();
        }, PTY_INPUT_BATCH_WINDOW_MS);
      }
    });
  }

  private flushCurrentBatch(): void {
    const batch = this.currentBatch;
    if (!batch) {
      return;
    }

    const timeoutApi = getWindowTimeoutApi();
    if (batch.timerId != null) {
      timeoutApi.clearTimeout(batch.timerId);
    }
    this.currentBatch = null;

    if (!this.ws || this.snapshot.phase !== "ready") {
      const error = createTransportError(
        this.snapshot.errorMessage ?? formatDisconnectedTransportMessage(),
      );
      batch.rejecters.forEach((reject) => reject(error));
      return;
    }

    try {
      this.ws.send(
        JSON.stringify({
          type: "input",
          input_seq: batch.inputSeq,
          data: encodeTextAsBase64(batch.data),
        }),
      );
    } catch {
      const error = createTransportError(formatDisconnectedTransportMessage());
      batch.rejecters.forEach((reject) => reject(error));
      this.failTransport(formatDisconnectedTransportMessage());
      return;
    }

    const ackTimerId = timeoutApi.setTimeout(() => {
      this.pendingAcks.delete(batch.inputSeq);
      const timeoutError = createTransportError(
        "终端输入确认超时，当前仅保留只读输出；请手动重试输入通道。",
      );
      log.warn(
        `[PtyInputTransport] input ack timed out for ${describePtyTarget(this.target)} input_seq=${batch.inputSeq}`,
      );
      batch.rejecters.forEach((reject) => reject(timeoutError));
      this.failTransport(timeoutError.message, { rejectAsIndeterminate: true });
    }, PTY_INPUT_ACK_TIMEOUT_MS);

    this.pendingAcks.set(batch.inputSeq, {
      timerId: ackTimerId,
      resolvers: batch.resolvers,
      rejecters: batch.rejecters,
    });
  }

  private failTransport(
    message: string,
    options: {
      rejectAsIndeterminate?: boolean;
      errorCode?: string | null;
    } = {},
  ): void {
    const timeoutApi = getWindowTimeoutApi();
    log.warn(
      `[PtyInputTransport] failing transport for ${describePtyTarget(this.target)}: ${message}`,
    );

    if (this.readyTimerId != null) {
      timeoutApi.clearTimeout(this.readyTimerId);
      this.readyTimerId = null;
    }

    const connectReject = this.rejectConnect;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;

    if (this.currentBatch?.timerId != null) {
      timeoutApi.clearTimeout(this.currentBatch.timerId);
    }
    if (this.currentBatch) {
      const error = createTransportError(message);
      this.currentBatch.rejecters.forEach((reject) => reject(error));
      this.currentBatch = null;
    }

    this.pendingAcks.forEach((pendingAck) => {
      timeoutApi.clearTimeout(pendingAck.timerId);
      const error = createTransportError(message);
      pendingAck.rejecters.forEach((reject) => reject(error));
    });
    this.pendingAcks.clear();

    this.pendingResizeAcks.forEach((pendingResizeAck) => {
      timeoutApi.clearTimeout(pendingResizeAck.timerId);
      const error = createTransportError(message);
      pendingResizeAck.rejecters.forEach((reject) => reject(error));
    });
    this.pendingResizeAcks.clear();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }

    if (connectReject) {
      connectReject(createTransportError(message));
    }

    this.setSnapshot({
      phase: "error",
      errorMessage: message,
      errorCode: options.errorCode ?? null,
      readOnly: true,
    });

    if (!options.rejectAsIndeterminate) {
      this.scheduleIdleClose();
    }
  }
}

function getOrCreatePtyInputTransport(
  target: PtyInputTarget,
): PtyInputWsTransport {
  const key = buildTransportKey(target);
  const existing = transportPool.get(key);
  if (existing) {
    return existing;
  }

  const transport = new PtyInputWsTransport(target);
  transportPool.set(key, transport);
  return transport;
}

export function retainPtyInputTransport(
  target: PtyInputTarget,
): PtyInputTransportLease {
  const transport = getOrCreatePtyInputTransport(target);
  transport.retain();
  return {
    getSnapshot: () => transport.getSnapshot(),
    retry: () => transport.retry(),
    release: () => transport.release(),
    subscribe: (listener) => transport.subscribe(listener),
  };
}

export function getPtyInputTransportSnapshot(
  target: PtyInputTarget,
): PtyInputTransportSnapshot {
  return getOrCreatePtyInputTransport(target).getSnapshot();
}

export function retryPtyInputTransport(target: PtyInputTarget): void {
  getOrCreatePtyInputTransport(target).retry();
}

export function subscribePtyInputTransport(
  target: PtyInputTarget,
  listener: PtyTransportListener,
): () => void {
  return getOrCreatePtyInputTransport(target).subscribe(listener);
}

export function encodeShortcutForPty(shortcut: string): string | null {
  const modifierCode = resolveArrowModifierCode(shortcut);
  const key = shortcut.split("+").pop() ?? "";

  if (key in PTY_ARROW_SEQUENCE_BY_KEY && modifierCode != null) {
    return `\u001b[1;${modifierCode}${PTY_ARROW_SEQUENCE_BY_KEY[key]}`;
  }

  if (key === "Enter" && modifierCode != null) {
    return "\u001b\r";
  }

  if (key === "Backspace" && modifierCode != null) {
    return "\u001b\u007f";
  }

  if (/^[A-Z]$/.test(key) && shortcut.startsWith("Alt+")) {
    const typed = shortcut.startsWith("Alt+Shift+") ? key : key.toLowerCase();
    return `\u001b${typed}`;
  }

  return null;
}

export async function sendPtyWsTextInput(
  target: PtyInputTarget,
  text: string,
): Promise<PtyInputTransportResponse> {
  return getOrCreatePtyInputTransport(target).sendText(text);
}

export async function sendPtyResize(
  target: PtyInputTarget,
  rows: number,
  cols: number,
): Promise<PtyInputTransportResponse> {
  return getOrCreatePtyInputTransport(target).sendResize(rows, cols);
}

export async function sendPtyShortcutInput(
  target: PtyInputTarget,
  shortcut: string,
): Promise<boolean> {
  const text = encodeShortcutForPty(shortcut);
  if (!text) {
    return false;
  }

  const response = await sendPtyWsTextInput(target, text);
  return response.ok;
}

export function __resetPtyInputTransportPoolForTests(): void {
  transportPool.forEach((transport) => transport.destroyForTests());
  transportPool.clear();
}
