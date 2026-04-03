import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { log } from '@/lib/logger';

// ── Types ──────────────────────────────────────────────────────

export interface PtyTerminalProps {
  rtBaseUrl: string;  // e.g., "http://127.0.0.1:1949"
  ptyId: string;
  authToken?: string;
  interactive?: boolean;
  onInitialConnectionFailure?: () => void;
}

const INITIAL_STREAM_CONNECT_RETRY_LIMIT = 2;
const INITIAL_STREAM_CONNECT_RETRY_DELAY_MS = 250;

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

// ── Component ──────────────────────────────────────────────────

export function PtyTerminal({
  rtBaseUrl,
  ptyId,
  authToken,
  interactive = true,
  onInitialConnectionFailure,
}: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Build auth helper ────────────────────────────────────

    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      return headers;
    };

    const buildStreamUrl = (): string => {
      const base = `${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/stream`;
      if (authToken) {
        return `${base}?token=${encodeURIComponent(authToken)}`;
      }
      return base;
    };

    const sendResize = (rows: number, cols: number) => {
      if (!interactive) {
        return;
      }
      fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/resize`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ rows, cols }),
      }).catch(() => {
        // Silently ignore resize failures
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
      allowProposedApi: true,
      disableStdin: !interactive,
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
      const encoder = new TextEncoder();
      const bytes = encoder.encode(text);
      const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
      const encoded = btoa(binary);

      fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/input`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ data: encoded }),
      }).catch((e: unknown) => log.error(`[PtyTerminal] pty input failed: ${e instanceof Error ? e.message : String(e)}`));
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
    let initialStreamConnected = false;
    let initialFailureNotified = false;
    let initialStreamRetryCount = 0;

    const clearConnectedEventSource = (es: EventSource) => {
      if (eventSourceRef.current === es) {
        eventSourceRef.current = null;
      }
      if (eventSource === es) {
        eventSource = null;
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
        connectSSE();
      }, delayMs);
    };

    const syncTerminalLayout = () => {
      // Wait for a measurable container before attaching stream output.
      if (container.clientWidth <= 0 || container.clientHeight <= 0) {
        return false;
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

    let eventSource: EventSource | null = null;

    const connectSSE = () => {
      const es = new EventSource(buildStreamUrl());
      eventSourceRef.current = es;
      eventSource = es;

      es.onopen = () => {
        initialStreamConnected = true;
        initialStreamRetryCount = 0;
      };

      es.addEventListener('output', (event) => {
        initialStreamConnected = true;
        try {
          const decoded = atob(event.data);
          const bytes = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            bytes[i] = decoded.charCodeAt(i);
          }
          terminal.write(bytes);
        } catch {
          terminal.write(event.data);
        }
      });

      es.addEventListener('eof', (event) => {
        initialStreamConnected = true;
        const exitCode = parsePtyExitCode(event.data);
        const message = formatPtyProcessExitedMessage(exitCode);
        terminal.write(`\r\n\x1b[90m${message}\x1b[0m\r\n`);
      });

      es.onerror = () => {
        if (!initialStreamConnected) {
          if (initialStreamRetryCount < INITIAL_STREAM_CONNECT_RETRY_LIMIT) {
            initialStreamRetryCount += 1;
            log.warn(
              `[PtyTerminal] initial stream connection failed for PTY ${ptyId}; retry ${initialStreamRetryCount}/${INITIAL_STREAM_CONNECT_RETRY_LIMIT}`,
            );
            es.close();
            clearConnectedEventSource(es);
            scheduleConnect(INITIAL_STREAM_CONNECT_RETRY_DELAY_MS);
            return;
          }

          if (!initialFailureNotified && onInitialConnectionFailure) {
            initialFailureNotified = true;
            onInitialConnectionFailure();
          }
          es.close();
          clearConnectedEventSource(es);
          return;
        }
        // EventSource will auto-reconnect by default
      };
    };

    // Use rAF to wait for first measurable layout, then:
    // 1. fit terminal to container
    // 2. refresh terminal canvas / rows
    // 3. send resize to PTY backend
    // 4. connect SSE only after resize is dispatched
    requestAnimationFrame(() => {
      if (syncTerminalLayout()) {
        // Auto-focus the terminal only when layout is ready
        if (interactive) {
          terminal.focus();
        }
      }
    });

    // ── Cleanup ──────────────────────────────────────────────

    return () => {
      if (interactive) {
        document.removeEventListener('paste', documentPasteHandler);
      }
      inputDisposable.dispose();
      resizeDisposable.dispose();

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [authToken, interactive, onInitialConnectionFailure, ptyId, rtBaseUrl]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-[200px]"
      style={{ backgroundColor: '#1C1917' }}
    />
  );
}
