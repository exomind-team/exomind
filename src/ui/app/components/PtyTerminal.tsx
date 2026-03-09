import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// ── Types ──────────────────────────────────────────────────────

export interface PtyTerminalProps {
  rtBaseUrl: string;  // e.g., "http://127.0.0.1:1949"
  ptyId: string;
  authToken?: string;
}

// ── Component ──────────────────────────────────────────────────

export function PtyTerminal({ rtBaseUrl, ptyId, authToken }: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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

    // ── Connect SSE output stream ────────────────────────────

    const es = new EventSource(buildStreamUrl());
    eventSourceRef.current = es;

    es.addEventListener('output', (event) => {
      try {
        const decoded = atob(event.data);
        // Convert binary string to Uint8Array so xterm.js decodes UTF-8 correctly.
        // atob() returns a binary string; passing it directly to terminal.write(string)
        // treats each char as UTF-16, corrupting multi-byte UTF-8 sequences (e.g. box-drawing chars).
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          bytes[i] = decoded.charCodeAt(i);
        }
        terminal.write(bytes);
      } catch {
        // If base64 decode fails, write raw data
        terminal.write(event.data);
      }
    });

    es.addEventListener('eof', () => {
      terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    });

    es.onerror = () => {
      // EventSource will auto-reconnect by default
    };

    // ── Handle user input → POST to backend ──────────────────

    const inputDisposable = terminal.onData((data) => {
      // Encode string to UTF-8 bytes first, then to base64.
      // btoa() only handles Latin-1; this approach correctly handles all characters.
      const encoder = new TextEncoder();
      const bytes = encoder.encode(data);
      const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
      const encoded = btoa(binary);

      fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/input`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ data: encoded }),
      }).catch(console.error);
    });

    // ── Handle resize → POST to backend ──────────────────────

    const resizeDisposable = terminal.onResize(({ rows, cols }) => {
      fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/resize`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ rows, cols }),
      }).catch(() => {
        // Silently ignore resize failures
      });
    });

    // ── ResizeObserver → refit terminal ──────────────────────

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during rapid resizing
      }
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    // ── Send initial resize ──────────────────────────────────

    // Defer to ensure terminal has computed its dimensions
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore
      }
      fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/resize`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ rows: terminal.rows, cols: terminal.cols }),
      }).catch(() => {
        // Silently ignore
      });
    });

    // ── Cleanup ──────────────────────────────────────────────

    return () => {
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

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [rtBaseUrl, ptyId, authToken]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-[200px]"
      style={{ backgroundColor: '#1C1917' }}
    />
  );
}
