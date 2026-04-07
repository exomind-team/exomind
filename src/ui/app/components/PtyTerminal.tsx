import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  getPtyTerminalReplayLimitKb,
  resolvePtyTerminalScrollbackLines,
  subscribePtyTerminalReplayLimitKbChanges,
} from '@/config/pty-terminal-preferences';
import { log } from '@/lib/logger';
import { sendPtyTextInput } from './pty-input';

// ── Types ──────────────────────────────────────────────────────

export interface PtyTerminalProps {
  rtBaseUrl: string;  // e.g., "http://127.0.0.1:1949"
  ptyId: string;
  authToken?: string;
  interactive?: boolean;
  autoFocus?: boolean;
  onInitialConnectionFailure?: () => void;
}

const INITIAL_STREAM_CONNECT_RETRY_LIMIT = 2;
const INITIAL_STREAM_CONNECT_RETRY_DELAY_MS = 250;
const INITIAL_STREAM_CONNECT_TIMEOUT_MS = 4_000;
const INITIAL_LAYOUT_READY_FALLBACK_CONNECT_MS = 1_200;
const STREAM_RECONNECT_DELAY_MS = 500;

function formatInitialStreamFailureSummary(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('401') || normalized.includes('403')) {
    return '会话加载失败：RT 鉴权失败';
  }
  if (normalized.includes('404')) {
    return '会话加载失败：当前 PTY 不存在';
  }
  if (normalized.includes('timeout') || normalized.includes('超时')) {
    return '会话加载失败：RT 响应超时';
  }
  return '会话加载失败：请检查 RT 或稍后重试';
}

function parsePtyExitCode(data: string): number | null {
  if (!data) {
    return null;
  }

  try {
    const payload = JSON.parse(data) as { code?: unknown };
    return typeof payload.code === 'number' && Number.isInteger(payload.code)
      ? payload.code
      : null;
  } catch {
    return null;
  }
}

function formatPtyProcessExitedMessage(exitCode: number | null): string {
  if (exitCode != null && exitCode !== 0) {
    return `[Process exited with code ${exitCode}]`;
  }
  return '[Process exited]';
}

function parseSseFrame(rawFrame: string): { eventType: string; data: string | null } {
  let eventType = 'message';
  const dataLines: string[] = [];

  for (const rawLine of rawFrame.split(/\r?\n/)) {
    if (rawLine.startsWith('event:')) {
      eventType = rawLine.slice(6).trim() || 'message';
      continue;
    }
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trim());
    }
  }

  return {
    eventType,
    data: dataLines.length > 0 ? dataLines.join('\n') : null,
  };
}

function includesWindowsPlatform(value: string | undefined): boolean {
  return typeof value === 'string' && value.toLowerCase().includes('win');
}

function resolveWindowsPtyOptions() {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  const userAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  if (
    includesWindowsPlatform(userAgentData.userAgentData?.platform)
    || includesWindowsPlatform(navigator.platform)
    || includesWindowsPlatform(navigator.userAgent)
  ) {
    return { backend: 'conpty' as const };
  }

  return undefined;
}

// ── Component ──────────────────────────────────────────────────

export function PtyTerminal({
  rtBaseUrl,
  ptyId,
  authToken,
  interactive = true,
  autoFocus = interactive,
  onInitialConnectionFailure,
}: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const onInitialConnectionFailureRef = useRef(onInitialConnectionFailure);
  const hasConnectedOnceRef = useRef(false);
  const scrollbackLinesRef = useRef(
    resolvePtyTerminalScrollbackLines(getPtyTerminalReplayLimitKb())
  );
  const [isStreamConnecting, setIsStreamConnecting] = useState(true);
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    onInitialConnectionFailureRef.current = onInitialConnectionFailure;
  }, [onInitialConnectionFailure]);

  useEffect(() => (
    subscribePtyTerminalReplayLimitKbChanges((replayLimitKb) => {
      const nextScrollbackLines = resolvePtyTerminalScrollbackLines(replayLimitKb);
      scrollbackLinesRef.current = nextScrollbackLines;
      if (terminalRef.current) {
        terminalRef.current.options.scrollback = nextScrollbackLines;
      }
    })
  ), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    hasConnectedOnceRef.current = false;

    const markStreamReady = () => {
      if (!disposed) {
        hasConnectedOnceRef.current = true;
        setStreamErrorMessage(null);
        setIsStreamConnecting(false);
      }
    };

    const resetStreamLoading = () => {
      if (!disposed && !hasConnectedOnceRef.current) {
        setStreamErrorMessage(null);
        setIsStreamConnecting(true);
      }
    };

    resetStreamLoading();

    // ── Build auth helper ────────────────────────────────────

    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      return headers;
    };

    const buildStreamHeaders = (): Record<string, string> => ({
      ...buildHeaders(),
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    });

    const buildStreamUrl = (): string => {
      const base = `${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/stream`;
      if (authToken) {
        return `${base}?token=${encodeURIComponent(authToken)}`;
      }
      return base;
    };

    let lastResizeRequestKey: string | null = null;
    let controlRequestPauseUntil = 0;

    const isFatalControlStatus = (status: number) => (
      status === 401 || status === 403 || status === 404
    );

    const isControlRequestPaused = () => Date.now() < controlRequestPauseUntil;

    const pauseControlRequests = (
      action: 'resize' | 'input',
      status: number,
    ) => {
      controlRequestPauseUntil = Date.now() + 1500;
      log.warn(
        `[PtyTerminal] pausing PTY ${ptyId} ${action} requests for 1500ms after HTTP ${status} from ${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/${action}`,
      );
    };

    const sendResize = (rows: number, cols: number) => {
      if (!interactive) {
        return;
      }
      if (isControlRequestPaused()) {
        return;
      }

      const requestKey = `${rows}x${cols}`;
      if (lastResizeRequestKey === requestKey) {
        return;
      }
      lastResizeRequestKey = requestKey;

      void fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/resize`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ rows, cols }),
      }).then((response) => {
        if (response.ok) {
          return;
        }
        if (!isFatalControlStatus(response.status)) {
          lastResizeRequestKey = null;
        } else {
          pauseControlRequests('resize', response.status);
        }
        log.warn(
          `[PtyTerminal] resize rejected for PTY ${ptyId} via ${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/resize with HTTP ${response.status}`,
        );
      }).catch((error: unknown) => {
        lastResizeRequestKey = null;
        log.error(
          `[PtyTerminal] resize request failed for PTY ${ptyId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    };

    // ── Create terminal ──────────────────────────────────────

    const terminal = new Terminal({
      theme: {
        background: '#1C1917',
        foreground: '#E7E5E4',
        cursor: '#C75B3A',
        selectionBackground: '#44403C',
      },
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      cursorBlink: interactive,
      scrollback: scrollbackLinesRef.current,
      scrollOnEraseInDisplay: true,
      allowProposedApi: true,
      disableStdin: !interactive,
      windowsPty: resolveWindowsPtyOptions(),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // ── Helper: send raw text to PTY backend ──────────────────

    const sendTextInput = (text: string) => {
      if (isControlRequestPaused()) {
        return;
      }
      void sendPtyTextInput({
        rtBaseUrl,
        ptyId,
        authToken,
      }, text).then((response) => {
        if (response.ok) {
          return;
        }
        if (isFatalControlStatus(response.status)) {
          pauseControlRequests('input', response.status);
        }
        log.warn(
          `[PtyTerminal] input rejected for PTY ${ptyId} via ${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/input with HTTP ${response.status}`,
        );
      }).catch((e: unknown) => {
        log.error(`[PtyTerminal] pty input failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    };

    // ── Handle user input → POST to backend ──────────────────

    const inputDisposable = interactive
      ? terminal.onData((data) => {
        sendTextInput(data);
      })
      : { dispose() {} };

    // ── Clipboard: Ctrl+Shift+C copy, Ctrl+V / Ctrl+Shift+V paste ──

    if (interactive) {
      terminal.attachCustomKeyEventHandler((e) => {
        // Ctrl+Shift+C → copy selection
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyC' && e.type === 'keydown') {
          const sel = terminal.getSelection();
          if (sel) void navigator.clipboard.writeText(sel);
          return false;
        }
        // Ctrl+V or Ctrl+Shift+V → paste from clipboard
        if (e.ctrlKey && (e.code === 'KeyV') && e.type === 'keydown') {
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
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
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
      const text = e.clipboardData?.getData('text');
      if (text) {
        sendTextInput(text);
        // Refocus terminal after paste (voice shortcut may have moved focus)
        if (interactive) {
          terminal.focus();
        }
      }
    };
    if (interactive) {
      document.addEventListener('paste', documentPasteHandler);
    }

    // ── Handle resize → POST to backend ──────────────────────

    const resizeDisposable = terminal.onResize(({ rows, cols }) => {
      sendResize(rows, cols);
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

    const isLatestConnectAttempt = (attemptId: number) => (
      !disposed && attemptId === latestConnectAttemptId
    );

    const invalidateConnectAttempt = (attemptId?: number) => {
      if (attemptId == null || latestConnectAttemptId === attemptId) {
        latestConnectAttemptId = 0;
      }
    };

    const clearConnectedStreamController = (controller: AbortController) => {
      if (streamAbortControllerRef.current === controller) {
        streamAbortControllerRef.current = null;
      }
      if (streamAbortController === controller) {
        streamAbortController = null;
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

      if (interactive) {
        sendResize(terminal.rows, terminal.cols);
      }

      if (!initialLayoutReady && !connectScheduled) {
        initialLayoutReady = true;
        scheduleConnect(50);
      }

      return true;
    };

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalLayout();
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    // ── Initial fit + resize THEN connect SSE ────────────────
    // Critical order: fit → resize → SSE.
    // If SSE connects before resize, the PTY uses default 80 cols
    // but the terminal may be narrower, causing cursor drift on backspace.

    let streamAbortController: AbortController | null = null;

    const finalizeInitialStreamFailure = (
      attemptId: number,
      message: string,
    ) => {
      if (!isLatestConnectAttempt(attemptId)) {
        return;
      }
      if (!disposed) {
        hasConnectedOnceRef.current = true;
        setIsStreamConnecting(false);
        setStreamErrorMessage(formatInitialStreamFailureSummary(message));
      }
      if (!initialFailureNotified && onInitialConnectionFailureRef.current) {
        initialFailureNotified = true;
        onInitialConnectionFailureRef.current();
      }
      invalidateConnectAttempt(attemptId);
    };

    const ensureInitialConnectWithoutLayout = () => {
      if (disposed || initialLayoutReady || connectScheduled || hasConnectedOnceRef.current) {
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
      options?: { skipRetry?: boolean },
    ) => {
      if (!isLatestConnectAttempt(attemptId)) {
        return;
      }
      if (!options?.skipRetry && initialStreamRetryCount < INITIAL_STREAM_CONNECT_RETRY_LIMIT) {
        initialStreamRetryCount += 1;
        log.warn(
          `[PtyTerminal] initial stream connection failed for PTY ${ptyId}; retry ${initialStreamRetryCount}/${INITIAL_STREAM_CONNECT_RETRY_LIMIT}: ${message}`,
        );
        invalidateConnectAttempt(attemptId);
        scheduleConnect(INITIAL_STREAM_CONNECT_RETRY_DELAY_MS);
        return;
      }

      log.warn(`[PtyTerminal] initial stream connection failed for PTY ${ptyId}; giving up: ${message}`);
      finalizeInitialStreamFailure(attemptId, message);
    };

    const connectStream = async () => {
      if (disposed) {
        return;
      }
      resetStreamLoading();
      const attemptId = ++connectAttemptSerial;
      latestConnectAttemptId = attemptId;
      const streamUrl = buildStreamUrl();
      const controller = new AbortController();
      streamAbortControllerRef.current = controller;
      streamAbortController = controller;
      let sawEof = false;
      let connectTimedOut = false;
      const connectTimeoutId = setTimeout(() => {
        if (disposed || latestConnectAttemptId !== attemptId) {
          return;
        }
        connectTimedOut = true;
        controller.abort();
      }, INITIAL_STREAM_CONNECT_TIMEOUT_MS);

      log.info(`[PtyTerminal] opening PTY stream ${ptyId} via ${streamUrl}`);

      let response: Response;
      try {
        response = await fetch(streamUrl, {
          headers: buildStreamHeaders(),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(connectTimeoutId);
        if (!isLatestConnectAttempt(attemptId)) {
          return;
        }
        if (controller.signal.aborted && !connectTimedOut) {
          invalidateConnectAttempt(attemptId);
          return;
        }
        clearConnectedStreamController(controller);
        if (connectTimedOut) {
          handleInitialStreamFailure(
            attemptId,
            `timeout after ${INITIAL_STREAM_CONNECT_TIMEOUT_MS}ms（终端流连接超时）`,
            { skipRetry: true },
          );
          return;
        }
        handleInitialStreamFailure(attemptId, error instanceof Error ? error.message : String(error));
        return;
      }
      clearTimeout(connectTimeoutId);

      if (!isLatestConnectAttempt(attemptId)) {
        try {
          response.body?.cancel();
        } catch {
          // Ignore cancellation failures for superseded attempts
        }
        return;
      }

      if (!response.ok || !response.body) {
        clearConnectedStreamController(controller);
        handleInitialStreamFailure(
          attemptId,
          !response.ok
            ? `HTTP ${response.status}`
            : 'empty stream body（终端流响应体为空）',
        );
        return;
      }

      initialStreamRetryCount = 0;
      controlRequestPauseUntil = 0;
      markStreamReady();
      log.info(
        `[PtyTerminal] PTY stream connected for ${ptyId} with HTTP ${response.status}`,
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (!disposed) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const { eventType, data } = parseSseFrame(frame);
            if (data == null) {
              continue;
            }

            if (eventType === 'output') {
              try {
                const decoded = atob(data);
                const bytes = new Uint8Array(decoded.length);
                for (let i = 0; i < decoded.length; i++) {
                  bytes[i] = decoded.charCodeAt(i);
                }
                terminal.write(bytes);
              } catch {
                terminal.write(data);
              }
              continue;
            }

            if (eventType === 'eof') {
              sawEof = true;
              const exitCode = parsePtyExitCode(data);
              const message = formatPtyProcessExitedMessage(exitCode);
              terminal.write(`\r\n\x1b[90m${message}\x1b[0m\r\n`);
            }
          }
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          log.warn(
            `[PtyTerminal] PTY stream reader failed for ${ptyId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        const shouldReconnect = (
          !disposed
          && latestConnectAttemptId === attemptId
          && !controller.signal.aborted
          && !sawEof
        );
        try {
          reader.releaseLock();
        } catch {
          // Ignore release errors during abort/dispose
        }
        clearConnectedStreamController(controller);
        if (!shouldReconnect) {
          invalidateConnectAttempt(attemptId);
          return;
        }
      }

      log.warn(`[PtyTerminal] PTY stream closed unexpectedly for ${ptyId}; reconnecting`);
      invalidateConnectAttempt(attemptId);
      scheduleConnect(STREAM_RECONNECT_DELAY_MS);
    };

    // Use rAF to wait for first measurable layout, then:
    // 1. fit terminal to container
    // 2. refresh terminal canvas / rows
    // 3. send resize to PTY backend
    // 4. connect SSE only after resize is dispatched
    requestAnimationFrame(() => {
      if (syncTerminalLayout()) {
        // Auto-focus the terminal only when layout is ready
        if (interactive && autoFocus) {
          terminal.focus();
        }
      }
    });

    // ── Cleanup ──────────────────────────────────────────────

    return () => {
      disposed = true;
      invalidateConnectAttempt();
      if (interactive) {
        document.removeEventListener('paste', documentPasteHandler);
      }
      inputDisposable.dispose();
      resizeDisposable.dispose();

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (streamAbortControllerRef.current) {
        streamAbortControllerRef.current.abort();
        streamAbortControllerRef.current = null;
      }
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (layoutFallbackTimer) {
        clearTimeout(layoutFallbackTimer);
        layoutFallbackTimer = null;
      }
      if (streamAbortController) {
        streamAbortController.abort();
        streamAbortController = null;
      }

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [authToken, autoFocus, interactive, ptyId, rtBaseUrl]);

  return (
    <div className="relative h-full w-full min-h-0" style={{ backgroundColor: '#1C1917' }}>
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
          <p className="text-sm text-[#FCA5A5]">
            {streamErrorMessage}
          </p>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="h-full w-full min-h-0"
        style={{ backgroundColor: '#1C1917' }}
      />
    </div>
  );
}
