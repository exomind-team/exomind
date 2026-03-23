import { ChevronLeft, Square } from 'lucide-react';
import { useState } from 'react';
import { PtyTerminal } from '../../components/PtyTerminal';
import { DEFAULT_EMBEDDED_RUNTIME_PORT } from '@/config/runtime-target';

export function PtyTerminalPage({ ptyId }: { ptyId?: string }) {
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  // Read baseUrl and token from URL search params — set by AgentsPage when navigating.
  // This avoids re-guessing the host inside the page and ensures the correct auth token
  // is used regardless of whether it is an embedded RT or a remote peer RT.
  const searchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const rtBaseUrl =
    searchParams.get('baseUrl') ?? `http://127.0.0.1:${DEFAULT_EMBEDDED_RUNTIME_PORT}`;
  // Auth token is passed via history.state (not URL) to keep it out of
  // browser history, address bar, and screenshots.
  const authToken =
    (typeof window !== 'undefined'
      ? (window.history.state as Record<string, unknown> | null)?.ptyToken
      : undefined) as string | undefined;

  const navigateBack = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/agents');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const handleStop = async () => {
    if (!ptyId || isStopping) return;
    setIsStopping(true);
    setStopError('');

    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/stop`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      navigateBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStopError(`结束 Terminal Agent 失败: ${message}`);
    } finally {
      setIsStopping(false);
    }
  };

  if (!ptyId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        无效的 PTY ID
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#1C1917]">
      <header className="flex items-center gap-2 border-b border-[#292524] px-4 py-3">
        <button
          type="button"
          onClick={navigateBack}
          className="flex h-7 w-7 items-center justify-center rounded text-[#A8A29E] hover:text-[#FAFAF9]"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="flex-1 text-sm font-semibold text-[#FAFAF9]">Terminal</span>
        <button
          type="button"
          data-testid="pty-terminal-page-stop"
          onClick={() => {
            void handleStop();
          }}
          disabled={isStopping}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[#FCA5A5] hover:text-[#FECACA] disabled:opacity-60"
          aria-label="结束 Terminal Agent"
        >
          <Square className="h-3.5 w-3.5" />
          {isStopping ? '停止中' : '结束'}
        </button>
      </header>
      {stopError && (
        <div className="border-b border-[#292524] px-4 py-2 text-xs text-[#FCA5A5]">
          {stopError}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <PtyTerminal rtBaseUrl={rtBaseUrl} ptyId={ptyId} authToken={authToken} />
      </div>
    </div>
  );
}
