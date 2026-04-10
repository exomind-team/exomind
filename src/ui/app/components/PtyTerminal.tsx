import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  getPtyTerminalReplayLimitKb,
  resolvePtyTerminalScrollbackLines,
  subscribePtyTerminalReplayLimitKbChanges,
} from "@/config/pty-terminal-preferences";
import { log } from "@/lib/logger";
import {
  PTY_WS_PROTOCOL_VERSION,
  getPtyInputTransportSnapshot,
  isPtyInputTransportPtyUnavailable,
  retainPtyInputTransport,
  retryPtyInputTransport,
  sendPtyResize,
  sendPtyWsTextInput,
  type PtyInputTarget,
  type PtyInputTransportSnapshot,
} from "./pty-input";

// ── Types ──────────────────────────────────────────────────────

export interface PtyTerminalProps {
  rtBaseUrl: string; // e.g., "http://127.0.0.1:1949"
  ptyId: string;
  authToken?: string;
  interactive?: boolean;
  inputPaused?: boolean;
  autoFocus?: boolean;
  onInitialConnectionFailure?: () => void;
  onPtyUnavailable?: () => void;
}

const INITIAL_STREAM_CONNECT_RETRY_LIMIT = 2;
const INITIAL_STREAM_CONNECT_RETRY_DELAY_MS = 250;
const INITIAL_STREAM_CONNECT_TIMEOUT_MS = 4_000;
const INITIAL_LAYOUT_READY_FALLBACK_CONNECT_MS = 1_200;
const STREAM_RECONNECT_DELAY_MS = 500;
const OUTPUT_WRITE_BATCH_FLUSH_MS = 16;
const READ_ONLY_INPUT_TRANSPORT_SNAPSHOT: PtyInputTransportSnapshot = {
  phase: "idle",
  errorMessage: null,
  errorCode: null,
  readOnly: false,
};

interface PtyOutputWsReadyMessage {
  type: "ready";
  protocol_version: number;
  read_only?: boolean;
  capabilities?: {
    output_stream?: boolean;
    output_cursor?: boolean;
  };
}

interface PtyOutputWsResetMessage {
  type: "output_reset";
  offset: number;
  truncated: boolean;
}

interface PtyOutputWsOutputMessage {
  type: "output";
  offset: number;
  data: string;
}

interface PtyOutputWsEofMessage {
  type: "eof";
  offset: number;
  code?: number | null;
}

interface PtyOutputWsErrorMessage {
  type: "error";
  code?: string;
  message?: string;
}

type PtyOutputWsServerMessage =
  | PtyOutputWsReadyMessage
  | PtyOutputWsResetMessage
  | PtyOutputWsOutputMessage
  | PtyOutputWsEofMessage
  | PtyOutputWsErrorMessage;

function formatInitialStreamFailureSummary(message: string): string {
  if (
    message.startsWith("会话加载失败：") ||
    message.includes("协议版本不兼容") ||
    message.includes("WebSocket 协议版本不兼容")
  ) {
    return message;
  }
  const normalized = message.toLowerCase();
  if (normalized.includes("401") || normalized.includes("403")) {
    return "会话加载失败：RT 鉴权失败";
  }
  if (normalized.includes("404")) {
    return "会话加载失败：当前 PTY 不存在";
  }
  if (normalized.includes("timeout") || normalized.includes("超时")) {
    return "会话加载失败：RT 响应超时";
  }
  return "会话加载失败：请检查 RT 或稍后重试";
}

function formatPtyProcessExitedMessage(exitCode: number | null): string {
  if (exitCode != null && exitCode !== 0) {
    return `[Process exited with code ${exitCode}]`;
  }
  return "[Process exited]";
}

function formatOutputProtocolMismatchMessage(): string {
  return "会话加载失败：当前 RT 的 PTY WebSocket 协议版本不兼容，请升级 Runtime 后重试。";
}

function isFatalOutputErrorCode(code: string | undefined): boolean {
  return (
    code === "not_found" || code === "unauthorized" || code === "forbidden"
  );
}

function formatOutputServerErrorSummary(
  message: PtyOutputWsErrorMessage,
): string {
  switch (message.code) {
    case "not_found":
      return "会话加载失败：当前 PTY 不存在";
    case "unauthorized":
    case "forbidden":
      return "会话加载失败：RT 鉴权失败";
    default:
      return formatInitialStreamFailureSummary(
        message.message?.trim() || "transport error（终端流连接失败）",
      );
  }
}

function formatOutputReconnectSummary(): string {
  return "终端输出通道重连中，输入已暂停；恢复后可继续输入。";
}

function shouldAutoRetryErroredInputTransport(
  snapshot: PtyInputTransportSnapshot,
): boolean {
  if (snapshot.phase !== "error" || !snapshot.readOnly) {
    return false;
  }

  if (
    snapshot.errorCode === "not_found" ||
    snapshot.errorCode === "unauthorized" ||
    snapshot.errorCode === "forbidden"
  ) {
    return false;
  }

  const message = snapshot.errorMessage ?? "";
  return (
    !message.includes("协议版本不兼容") && !message.includes("升级 Runtime")
  );
}

function resolveOutputReadyCompatibilityError(
  message: PtyOutputWsReadyMessage,
): string | null {
  if (message.protocol_version !== PTY_WS_PROTOCOL_VERSION) {
    return formatOutputProtocolMismatchMessage();
  }

  if (
    message.capabilities?.output_stream !== true ||
    message.capabilities?.output_cursor !== true
  ) {
    return formatOutputProtocolMismatchMessage();
  }

  return null;
}

function buildPtyOutputWebSocketUrl(
  rtBaseUrl: string,
  ptyId: string,
  authToken?: string,
  cursor?: number | null,
): string {
  const url = new URL(rtBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/pty/${encodeURIComponent(ptyId)}/ws`;
  url.search = "";

  const normalizedToken = authToken?.trim();
  url.searchParams.set("mode", "output");
  if (normalizedToken) {
    url.searchParams.set("token", normalizedToken);
  }
  if (typeof cursor === "number" && Number.isFinite(cursor)) {
    url.searchParams.set("cursor", String(cursor));
  }

  return url.toString();
}

function decodePtyOutputPayload(data: string): Uint8Array {
  try {
    const decoded = atob(data);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new TextEncoder().encode(data);
  }
}

function includesWindowsPlatform(value: string | undefined): boolean {
  return typeof value === "string" && value.toLowerCase().includes("win");
}

function resolveWindowsPtyOptions() {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  const userAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  if (
    includesWindowsPlatform(userAgentData.userAgentData?.platform) ||
    includesWindowsPlatform(navigator.platform) ||
    includesWindowsPlatform(navigator.userAgent)
  ) {
    return { backend: "conpty" as const };
  }

  return undefined;
}

// ── Component ──────────────────────────────────────────────────

export function PtyTerminal({
  rtBaseUrl,
  ptyId,
  authToken,
  interactive = true,
  inputPaused = false,
  autoFocus = interactive && !inputPaused,
  onInitialConnectionFailure,
  onPtyUnavailable,
}: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputSocketRef = useRef<WebSocket | null>(null);
  const outputCursorRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const onInitialConnectionFailureRef = useRef(onInitialConnectionFailure);
  const onPtyUnavailableRef = useRef(onPtyUnavailable);
  const inputPausedRef = useRef(inputPaused);
  const syncTerminalInteractivityRef = useRef<() => void>(() => {});
  const hasConnectedOnceRef = useRef(false);
  const hasReportedPtyUnavailableRef = useRef(false);
  const scrollbackLinesRef = useRef(
    resolvePtyTerminalScrollbackLines(getPtyTerminalReplayLimitKb()),
  );
  const [isStreamConnecting, setIsStreamConnecting] = useState(true);
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(
    null,
  );
  const [outputReconnectMessage, setOutputReconnectMessage] = useState<
    string | null
  >(null);
  const [inputTransportSnapshot, setInputTransportSnapshot] =
    useState<PtyInputTransportSnapshot>(
      interactive
        ? getPtyInputTransportSnapshot({ rtBaseUrl, ptyId, authToken })
        : READ_ONLY_INPUT_TRANSPORT_SNAPSHOT,
    );

  useEffect(() => {
    onInitialConnectionFailureRef.current = onInitialConnectionFailure;
  }, [onInitialConnectionFailure]);

  useEffect(() => {
    onPtyUnavailableRef.current = onPtyUnavailable;
  }, [onPtyUnavailable]);

  useEffect(() => {
    inputPausedRef.current = inputPaused;
    syncTerminalInteractivityRef.current();
  }, [inputPaused]);

  useEffect(
    () =>
      subscribePtyTerminalReplayLimitKbChanges((replayLimitKb) => {
        const nextScrollbackLines =
          resolvePtyTerminalScrollbackLines(replayLimitKb);
        scrollbackLinesRef.current = nextScrollbackLines;
        if (terminalRef.current) {
          terminalRef.current.options.scrollback = nextScrollbackLines;
        }
      }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    hasConnectedOnceRef.current = false;
    hasReportedPtyUnavailableRef.current = false;
    outputCursorRef.current = null;

    // ── Build auth helper ────────────────────────────────────

    const inputTarget: PtyInputTarget = {
      rtBaseUrl,
      ptyId,
      authToken,
    };
    const inputTransport = interactive
      ? retainPtyInputTransport(inputTarget)
      : null;
    let lastAppliedResizeRequestKey: string | null = null;
    let pendingResizeRequestKey: string | null = null;
    let pendingResizePromise: Promise<boolean> | null = null;
    let latestResizeAttemptId = 0;
    let outputTerminated = false;
    let outputInputBlocked = true;
    let sendResize: ((rows: number, cols: number) => Promise<boolean>) | null =
      null;
    const getCurrentInputTransportSnapshot = (): PtyInputTransportSnapshot =>
      inputTransport?.getSnapshot() ?? READ_ONLY_INPUT_TRANSPORT_SNAPSHOT;
    const notifyPtyUnavailable = () => {
      if (disposed || hasReportedPtyUnavailableRef.current) {
        return;
      }
      hasReportedPtyUnavailableRef.current = true;
      onPtyUnavailableRef.current?.();
    };
    const syncTerminalInteractivity = (
      snapshot: PtyInputTransportSnapshot = getCurrentInputTransportSnapshot(),
    ) => {
      if (terminalRef.current) {
        terminalRef.current.options.cursorBlink =
          interactive && !inputPausedRef.current;
        terminalRef.current.options.disableStdin =
          !interactive ||
          inputPausedRef.current ||
          outputTerminated ||
          outputInputBlocked ||
          snapshot.phase !== "ready";
      }
    };
    syncTerminalInteractivityRef.current = () => {
      syncTerminalInteractivity();
    };
    const clearOutputReconnectNotice = () => {
      if (!disposed) {
        setOutputReconnectMessage(null);
      }
    };
    const retryErroredInputTransportAfterOutputReady = () => {
      if (!interactive || !inputTransport) {
        return;
      }

      const snapshot = inputTransport.getSnapshot();
      if (!shouldAutoRetryErroredInputTransport(snapshot)) {
        return;
      }

      log.info(
        `[PtyTerminal] auto-retrying input transport for PTY ${ptyId} after output became ready`,
      );
      inputTransport.retry();
    };
    const showOutputReconnectNotice = () => {
      outputInputBlocked = true;
      syncTerminalInteractivity();
      if (!disposed) {
        setIsStreamConnecting(false);
        setStreamErrorMessage(null);
        setOutputReconnectMessage(formatOutputReconnectSummary());
      }
    };
    const showOutputFatalOverlay = (message: string) => {
      outputInputBlocked = true;
      syncTerminalInteractivity();
      if (!disposed) {
        setOutputReconnectMessage(null);
        setIsStreamConnecting(false);
        setStreamErrorMessage(formatInitialStreamFailureSummary(message));
      }
    };
    const markStreamReady = () => {
      outputInputBlocked = false;
      syncTerminalInteractivity();
      if (!disposed) {
        hasConnectedOnceRef.current = true;
        clearOutputReconnectNotice();
        setStreamErrorMessage(null);
        setIsStreamConnecting(false);
      }
      retryErroredInputTransportAfterOutputReady();
    };
    const resetStreamLoading = () => {
      outputInputBlocked = true;
      syncTerminalInteractivity();
      if (!disposed && !hasConnectedOnceRef.current) {
        clearOutputReconnectNotice();
        setStreamErrorMessage(null);
        setIsStreamConnecting(true);
      }
    };

    resetStreamLoading();
    const updateInputTransportState = (snapshot: PtyInputTransportSnapshot) => {
      if (disposed) {
        return;
      }
      setInputTransportSnapshot(snapshot);
      if (
        hasConnectedOnceRef.current &&
        isPtyInputTransportPtyUnavailable(snapshot)
      ) {
        notifyPtyUnavailable();
      }
      if (snapshot.phase !== "ready") {
        lastAppliedResizeRequestKey = null;
        pendingResizeRequestKey = null;
        pendingResizePromise = null;
      }
      syncTerminalInteractivity(snapshot);
      if (
        terminalRef.current &&
        interactive &&
        snapshot.phase === "ready" &&
        sendResize
      ) {
        void sendResize(terminalRef.current.rows, terminalRef.current.cols);
      }
    };
    if (inputTransport) {
      updateInputTransportState(inputTransport.getSnapshot());
    } else {
      updateInputTransportState(READ_ONLY_INPUT_TRANSPORT_SNAPSHOT);
    }
    const unsubscribeInputTransport = inputTransport?.subscribe(
      updateInputTransportState,
    );

    sendResize = (rows: number, cols: number) => {
      if (!interactive) {
        return Promise.resolve(true);
      }

      const requestKey = `${rows}x${cols}`;
      if (pendingResizeRequestKey === requestKey && pendingResizePromise) {
        return pendingResizePromise;
      }
      if (
        !pendingResizeRequestKey &&
        lastAppliedResizeRequestKey === requestKey
      ) {
        return Promise.resolve(true);
      }

      const attemptId = ++latestResizeAttemptId;
      pendingResizeRequestKey = requestKey;
      pendingResizePromise = sendPtyResize(inputTarget, rows, cols)
        .then((response) => {
          if (attemptId !== latestResizeAttemptId) {
            return response.ok;
          }

          pendingResizeRequestKey = null;
          pendingResizePromise = null;
          if (response.ok) {
            lastAppliedResizeRequestKey = requestKey;
            return true;
          }

          log.warn(
            `[PtyTerminal] resize rejected for PTY ${ptyId} via WS with status ${response.status}`,
          );
          return false;
        })
        .catch((error: unknown) => {
          if (attemptId === latestResizeAttemptId) {
            pendingResizeRequestKey = null;
            pendingResizePromise = null;
          }
          log.error(
            `[PtyTerminal] resize request failed for PTY ${ptyId} via WS: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        });

      return pendingResizePromise;
    };

    // ── Create terminal ──────────────────────────────────────

    const terminal = new Terminal({
      theme: {
        background: "#1C1917",
        foreground: "#E7E5E4",
        cursor: "#C75B3A",
        selectionBackground: "#44403C",
      },
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      cursorBlink: interactive && !inputPausedRef.current,
      scrollback: scrollbackLinesRef.current,
      scrollOnEraseInDisplay: true,
      allowProposedApi: true,
      disableStdin:
        !interactive ||
        inputPausedRef.current ||
        outputTerminated ||
        outputInputBlocked ||
        inputTransportSnapshot.phase !== "ready",
      windowsPty: resolveWindowsPtyOptions(),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    syncTerminalInteractivity();

    let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingOutputChunks: Uint8Array[] = [];

    const flushPendingOutput = () => {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }
      if (pendingOutputChunks.length === 0) {
        return;
      }

      const totalLength = pendingOutputChunks.reduce(
        (sum, chunk) => sum + chunk.length,
        0,
      );
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      pendingOutputChunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.length;
      });
      pendingOutputChunks = [];
      terminal.write(merged);
    };

    const queueOutputChunk = (chunk: Uint8Array) => {
      pendingOutputChunks.push(chunk);
      if (outputFlushTimer) {
        return;
      }
      outputFlushTimer = setTimeout(() => {
        flushPendingOutput();
      }, OUTPUT_WRITE_BATCH_FLUSH_MS);
    };

    const resetTerminalOutput = () => {
      flushPendingOutput();
      const resettableTerminal = terminal as Terminal & {
        clear?: () => void;
        reset?: () => void;
      };
      if (typeof resettableTerminal.clear === "function") {
        resettableTerminal.clear();
        return;
      }
      if (typeof resettableTerminal.reset === "function") {
        resettableTerminal.reset();
        return;
      }
      terminal.write("\x1bc");
    };

    const applyOutputReset = (offset: number, truncated: boolean) => {
      const currentCursor = outputCursorRef.current;
      const needsReset =
        currentCursor == null || truncated || currentCursor !== offset;
      if (needsReset) {
        resetTerminalOutput();
      }
      outputCursorRef.current = offset;
    };

    const applyOutputChunk = (offset: number, encodedData: string) => {
      let nextOffset = offset;
      let chunk = decodePtyOutputPayload(encodedData);
      const currentCursor = outputCursorRef.current;

      if (currentCursor != null) {
        const chunkEnd = offset + chunk.length;
        if (chunkEnd <= currentCursor) {
          return;
        }
        if (offset < currentCursor) {
          const skip = currentCursor - offset;
          chunk = chunk.slice(skip);
          nextOffset = currentCursor;
        } else if (offset > currentCursor) {
          log.warn(
            `[PtyTerminal] output cursor gap for PTY ${ptyId}: expected ${currentCursor}, got ${offset}`,
          );
          resetTerminalOutput();
          outputCursorRef.current = offset;
        }
      }

      if (chunk.length === 0) {
        return;
      }

      queueOutputChunk(chunk);
      outputCursorRef.current = nextOffset + chunk.length;
    };

    // ── Helper: send raw text to PTY backend ──────────────────

    const sendTextInput = (text: string) => {
      const snapshot = getCurrentInputTransportSnapshot();
      if (
        inputPausedRef.current ||
        outputTerminated ||
        outputInputBlocked ||
        snapshot.phase !== "ready"
      ) {
        return;
      }
      void sendPtyWsTextInput(inputTarget, text)
        .then((response) => {
          if (response.ok) {
            return;
          }
          log.warn(
            `[PtyTerminal] input rejected for PTY ${ptyId} via WS with status ${response.status}`,
          );
        })
        .catch((e: unknown) => {
          log.error(
            `[PtyTerminal] pty input failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    };

    // ── Handle user input → WebSocket transport ──────────────

    const inputDisposable = interactive
      ? terminal.onData((data) => {
          sendTextInput(data);
        })
      : { dispose() {} };

    // ── Clipboard: Ctrl+Shift+C copy, Ctrl+V / Ctrl+Shift+V paste ──

    if (interactive) {
      terminal.attachCustomKeyEventHandler((e) => {
        // Ctrl+Shift+C → copy selection
        if (
          e.ctrlKey &&
          e.shiftKey &&
          e.code === "KeyC" &&
          e.type === "keydown"
        ) {
          const sel = terminal.getSelection();
          if (sel) void navigator.clipboard.writeText(sel);
          return false;
        }
        // Ctrl+V or Ctrl+Shift+V → paste from clipboard
        if (e.ctrlKey && e.code === "KeyV" && e.type === "keydown") {
          e.preventDefault(); // Prevent browser paste event (avoids double input from simulate_paste)
          void navigator.clipboard.readText().then((text) => {
            if (text) sendTextInput(text);
          });
          return false;
        }
        return true;
      });
    }

    // ── Browser paste event ──────────────────────────────────
    // Listen on DOCUMENT level to capture paste events even when focus is
    // elsewhere (e.g. after voice recognition's simulate_paste steals focus).
    // Only intercept when the terminal container is visible.

    const documentPasteHandler = (e: ClipboardEvent) => {
      // Only intercept if our container is visible (not display:none) and
      // the paste target isn't another input/textarea element.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (!container.offsetParent) return; // hidden (display:none)

      // Multi-instance fix: only handle paste if this terminal's container
      // contains the active element (has focus), or if paste target is
      // inside our container. This prevents all PtyTerminal instances from
      // receiving the same paste event simultaneously.
      const activeEl = document.activeElement;
      const hasContainerFocus = activeEl && container.contains(activeEl);
      const isTargetInContainer = target && container.contains(target);
      if (!hasContainerFocus && !isTargetInContainer) return;

      e.preventDefault();
      const text = e.clipboardData?.getData("text");
      if (text) {
        sendTextInput(text);
        // Refocus terminal after paste (voice shortcut may have moved focus)
        if (interactive && !inputPausedRef.current) {
          terminal.focus();
        }
      }
    };
    if (interactive) {
      document.addEventListener("paste", documentPasteHandler);
    }

    // ── Handle resize → POST to backend ──────────────────────

    const resizeDisposable = terminal.onResize(({ rows, cols }) => {
      void sendResize?.(rows, cols);
    });

    // ── ResizeObserver → refit terminal ──────────────────────

    let connectScheduled = false;
    let initialLayoutReady = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let layoutFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let initialFailureNotified = false;
    let initialStreamRetryCount = 0;
    let connectAttemptSerial = 0;
    let latestConnectAttemptId = 0;

    const isLatestConnectAttempt = (attemptId: number) =>
      !disposed && attemptId === latestConnectAttemptId;

    const invalidateConnectAttempt = (attemptId?: number) => {
      if (attemptId == null || latestConnectAttemptId === attemptId) {
        latestConnectAttemptId = 0;
      }
    };

    const clearConnectedOutputSocket = (socket: WebSocket) => {
      if (outputSocketRef.current === socket) {
        outputSocketRef.current = null;
      }
      if (outputSocket === socket) {
        outputSocket = null;
      }
    };

    const scheduleConnect = (delayMs: number) => {
      if (connectTimer) {
        clearTimeout(connectTimer);
      }
      connectScheduled = true;
      connectTimer = setTimeout(() => {
        connectTimer = null;
        connectScheduled = false;
        void connectStream();
      }, delayMs);
    };

    const syncTerminalLayout = () => {
      // Wait for a measurable container before attaching stream output.
      if (container.clientWidth <= 0 || container.clientHeight <= 0) {
        return false;
      }

      if (layoutFallbackTimer) {
        clearTimeout(layoutFallbackTimer);
        layoutFallbackTimer = null;
      }

      try {
        fitAddon.fit();
        terminal.refresh(0, Math.max(terminal.rows - 1, 0));
      } catch {
        // Ignore fit/refresh errors during rapid resizing
      }

      if (!initialLayoutReady && !connectScheduled) {
        initialLayoutReady = true;
        if (interactive && sendResize) {
          void sendResize(terminal.rows, terminal.cols).finally(() => {
            if (!disposed && !connectScheduled) {
              scheduleConnect(50);
            }
          });
        } else {
          scheduleConnect(50);
        }
      } else if (interactive && sendResize) {
        void sendResize(terminal.rows, terminal.cols);
      }

      return true;
    };

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalLayout();
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    // ── Initial fit + resize ack THEN connect output WS ─────
    // Critical order: fit → dispatch resize → wait for resize result → output WS.
    // If output WS connects before the resize result settles, the PTY can emit output
    // using stale geometry and reintroduce cursor drift on backspace/wrapping.

    let outputSocket: WebSocket | null = null;

    const finalizeInitialStreamFailure = (
      attemptId: number,
      message: string,
    ) => {
      if (!isLatestConnectAttempt(attemptId)) {
        return;
      }
      if (!disposed) {
        hasConnectedOnceRef.current = true;
        showOutputFatalOverlay(message);
      }
      if (!initialFailureNotified && onInitialConnectionFailureRef.current) {
        initialFailureNotified = true;
        onInitialConnectionFailureRef.current();
      }
      invalidateConnectAttempt(attemptId);
    };

    const ensureInitialConnectWithoutLayout = () => {
      if (
        disposed ||
        initialLayoutReady ||
        connectScheduled ||
        hasConnectedOnceRef.current
      ) {
        return;
      }

      initialLayoutReady = true;
      log.warn(
        `[PtyTerminal] PTY ${ptyId} container stayed unmeasurable for ${INITIAL_LAYOUT_READY_FALLBACK_CONNECT_MS}ms; connecting stream before first fit/resize`,
      );
      scheduleConnect(0);
    };

    layoutFallbackTimer = setTimeout(
      ensureInitialConnectWithoutLayout,
      INITIAL_LAYOUT_READY_FALLBACK_CONNECT_MS,
    );

    const handleInitialStreamFailure = (
      attemptId: number,
      message: string,
      options?: { skipRetry?: boolean; fatal?: boolean },
    ) => {
      if (!isLatestConnectAttempt(attemptId)) {
        return;
      }
      if (hasConnectedOnceRef.current) {
        if (options?.fatal) {
          showOutputFatalOverlay(message);
          invalidateConnectAttempt(attemptId);
          return;
        }
        log.warn(
          `[PtyTerminal] PTY output reconnect failed for ${ptyId}; retrying: ${message}`,
        );
        invalidateConnectAttempt(attemptId);
        scheduleConnect(STREAM_RECONNECT_DELAY_MS);
        return;
      }
      if (
        !options?.skipRetry &&
        initialStreamRetryCount < INITIAL_STREAM_CONNECT_RETRY_LIMIT
      ) {
        initialStreamRetryCount += 1;
        log.warn(
          `[PtyTerminal] initial stream connection failed for PTY ${ptyId}; retry ${initialStreamRetryCount}/${INITIAL_STREAM_CONNECT_RETRY_LIMIT}: ${message}`,
        );
        invalidateConnectAttempt(attemptId);
        scheduleConnect(INITIAL_STREAM_CONNECT_RETRY_DELAY_MS);
        return;
      }

      log.warn(
        `[PtyTerminal] initial stream connection failed for PTY ${ptyId}; giving up: ${message}`,
      );
      finalizeInitialStreamFailure(attemptId, message);
    };

    const connectStream = async () => {
      if (disposed) {
        return;
      }
      resetStreamLoading();
      const attemptId = ++connectAttemptSerial;
      latestConnectAttemptId = attemptId;
      const streamUrl = buildPtyOutputWebSocketUrl(
        rtBaseUrl,
        ptyId,
        authToken,
        outputCursorRef.current,
      );
      const socket = new WebSocket(streamUrl);
      outputSocketRef.current = socket;
      outputSocket = socket;
      let sawReady = false;
      let sawEof = false;
      let connectTimedOut = false;
      let reconnectFailureMessage: string | null = null;
      const connectTimeoutId = setTimeout(() => {
        if (disposed || latestConnectAttemptId !== attemptId) {
          return;
        }
        connectTimedOut = true;
        socket.close();
      }, INITIAL_STREAM_CONNECT_TIMEOUT_MS);

      log.info(
        `[PtyTerminal] opening PTY output websocket ${ptyId} via ${streamUrl}`,
      );

      socket.onopen = () => {
        log.info(`[PtyTerminal] PTY output websocket opened for ${ptyId}`);
      };

      socket.onmessage = (event) => {
        let message: PtyOutputWsServerMessage;
        try {
          message = JSON.parse(String(event.data)) as PtyOutputWsServerMessage;
        } catch {
          if (!sawReady) {
            clearTimeout(connectTimeoutId);
            clearConnectedOutputSocket(socket);
            handleInitialStreamFailure(
              attemptId,
              "invalid websocket payload（终端流消息不可识别）",
            );
          } else {
            log.error(
              `[PtyTerminal] PTY output websocket sent invalid payload after ready for ${ptyId}; reconnecting`,
            );
            socket.close();
          }
          return;
        }

        if (message.type === "ready") {
          const compatibilityError =
            resolveOutputReadyCompatibilityError(message);
          if (compatibilityError) {
            clearTimeout(connectTimeoutId);
            clearConnectedOutputSocket(socket);
            handleInitialStreamFailure(attemptId, compatibilityError, {
              skipRetry: true,
              fatal: true,
            });
            socket.close();
            return;
          }

          clearTimeout(connectTimeoutId);
          sawReady = true;
          initialStreamRetryCount = 0;
          if (interactive && message.read_only === true) {
            if (!disposed) {
              hasConnectedOnceRef.current = true;
              outputInputBlocked = true;
              syncTerminalInteractivity();
              clearOutputReconnectNotice();
              setStreamErrorMessage(null);
              setIsStreamConnecting(false);
            }
            log.warn(
              `[PtyTerminal] PTY output websocket entered read-only history mode for live terminal ${ptyId}; marking PTY unavailable`,
            );
            notifyPtyUnavailable();
            return;
          }
          markStreamReady();
          return;
        }

        if (message.type === "output_reset") {
          applyOutputReset(message.offset, message.truncated);
          return;
        }

        if (message.type === "output") {
          applyOutputChunk(message.offset, message.data);
          return;
        }

        if (message.type === "eof") {
          sawEof = true;
          outputTerminated = true;
          outputInputBlocked = true;
          clearTimeout(connectTimeoutId);
          clearOutputReconnectNotice();
          flushPendingOutput();
          outputCursorRef.current = Math.max(
          outputCursorRef.current ?? 0,
          message.offset,
        );
          syncTerminalInteractivity();
          const exitCode =
            typeof message.code === "number" ? message.code : null;
          terminal.write(
            `\r\n\x1b[90m${formatPtyProcessExitedMessage(exitCode)}\x1b[0m\r\n`,
          );
          return;
        }

        if (message.type === "error") {
          clearTimeout(connectTimeoutId);
          if (!sawReady) {
            clearConnectedOutputSocket(socket);
            const summary = isFatalOutputErrorCode(message.code)
              ? formatOutputServerErrorSummary(message)
              : message.message?.trim() || "transport error（终端流连接失败）";
            handleInitialStreamFailure(
              attemptId,
              summary,
              isFatalOutputErrorCode(message.code)
                ? { skipRetry: true, fatal: true }
                : undefined,
            );
            return;
          }

          log.error(
            `[PtyTerminal] PTY output websocket reported an error for ${ptyId}: ${message.message?.trim() || "transport error"}`,
          );
          if (message.code === "not_found") {
            notifyPtyUnavailable();
          }
          if (isFatalOutputErrorCode(message.code)) {
            reconnectFailureMessage = formatOutputServerErrorSummary(message);
          }
          socket.close();
        }
      };

      socket.onerror = () => {
        // Browser WebSocket errors do not expose actionable details.
      };

      socket.onclose = () => {
        clearTimeout(connectTimeoutId);
        if (!isLatestConnectAttempt(attemptId)) {
          return;
        }
        clearConnectedOutputSocket(socket);
        if (connectTimedOut) {
          handleInitialStreamFailure(
            attemptId,
            `timeout after ${INITIAL_STREAM_CONNECT_TIMEOUT_MS}ms（终端流连接超时）`,
            { skipRetry: true },
          );
          return;
        }

        if (!sawReady) {
          handleInitialStreamFailure(
            attemptId,
            "websocket closed before ready（终端流连接关闭）",
          );
          return;
        }

        if (disposed || sawEof) {
          invalidateConnectAttempt(attemptId);
          return;
        }

        if (reconnectFailureMessage) {
          outputInputBlocked = true;
          syncTerminalInteractivity();
          clearOutputReconnectNotice();
          setStreamErrorMessage(reconnectFailureMessage);
          invalidateConnectAttempt(attemptId);
          return;
        }

        log.warn(
          `[PtyTerminal] PTY output websocket closed unexpectedly for ${ptyId}; reconnecting`,
        );
        showOutputReconnectNotice();
        invalidateConnectAttempt(attemptId);
        scheduleConnect(STREAM_RECONNECT_DELAY_MS);
      };
    };

    // Use rAF to wait for first measurable layout, then:
    // 1. fit terminal to container
    // 2. refresh terminal canvas / rows
    // 3. send resize to PTY backend
    // 4. connect output WS only after the resize request settles
    requestAnimationFrame(() => {
      if (syncTerminalLayout()) {
        // Auto-focus the terminal only when layout is ready
        if (interactive && !inputPausedRef.current && autoFocus) {
          terminal.focus();
        }
      }
    });

    // ── Cleanup ──────────────────────────────────────────────

    return () => {
      disposed = true;
      syncTerminalInteractivityRef.current = () => {};
      invalidateConnectAttempt();
      if (interactive) {
        document.removeEventListener("paste", documentPasteHandler);
      }
      unsubscribeInputTransport?.();
      inputTransport?.release();
      inputDisposable.dispose();
      resizeDisposable.dispose();

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (outputSocketRef.current) {
        outputSocketRef.current.close();
        outputSocketRef.current = null;
      }
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (layoutFallbackTimer) {
        clearTimeout(layoutFallbackTimer);
        layoutFallbackTimer = null;
      }
      if (outputSocket) {
        outputSocket.close();
        outputSocket = null;
      }
      flushPendingOutput();

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [authToken, autoFocus, interactive, ptyId, rtBaseUrl]);

  return (
    <div
      className="relative h-full w-full min-h-0"
      style={{ backgroundColor: "#1C1917" }}
    >
      {isStreamConnecting ? (
        <div
          data-testid="pty-terminal-loading"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[#1C1917]/90 text-xs text-[#A8A29E]"
        >
          会话加载中...
        </div>
      ) : null}
      {!isStreamConnecting && streamErrorMessage ? (
        <div
          data-testid="pty-terminal-error"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[#1C1917]/92 px-6 text-center"
        >
          <p className="text-sm text-[#FCA5A5]">{streamErrorMessage}</p>
        </div>
      ) : null}
      {!isStreamConnecting && !streamErrorMessage && outputReconnectMessage ? (
        <div
          data-testid="pty-terminal-output-reconnecting"
          className="absolute left-3 right-3 top-3 z-20 rounded border border-[#0F766E] bg-[#1C1917]/95 px-3 py-2 text-xs text-[#99F6E4]"
        >
          <p>{outputReconnectMessage}</p>
        </div>
      ) : null}
      {!isStreamConnecting &&
      !streamErrorMessage &&
      interactive &&
      inputTransportSnapshot.phase === "error" ? (
        <div
          data-testid="pty-terminal-input-error"
          className="absolute left-3 right-3 top-3 z-20 flex items-center justify-between gap-3 rounded border border-[#92400E] bg-[#1C1917]/95 px-3 py-2 text-xs text-[#FDE68A]"
        >
          <p className="min-w-0 flex-1">
            {inputTransportSnapshot.errorMessage ??
              "终端输入通道已断开，当前仅保留只读输出；请手动重试输入通道。"}
          </p>
          <button
            type="button"
            data-testid="pty-terminal-input-retry"
            className="shrink-0 rounded border border-[#A16207] px-2 py-1 text-[11px] text-[#FDE68A] hover:border-[#CA8A04]"
            onClick={() => {
              retryPtyInputTransport({ rtBaseUrl, ptyId, authToken });
            }}
          >
            重试输入
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="h-full w-full min-h-0"
        style={{ backgroundColor: "#1C1917" }}
      />
    </div>
  );
}
