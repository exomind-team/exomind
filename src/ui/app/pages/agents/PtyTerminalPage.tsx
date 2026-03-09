import { ChevronLeft } from 'lucide-react';
import { PtyTerminal } from '../../components/PtyTerminal';
import { DEFAULT_EMBEDDED_RUNTIME_PORT } from '@/config/runtime-target';

export function PtyTerminalPage({ ptyId }: { ptyId?: string }) {
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
        <span className="text-sm font-semibold text-[#FAFAF9]">Terminal</span>
      </header>
      <div className="flex-1 overflow-hidden">
        <PtyTerminal rtBaseUrl={rtBaseUrl} ptyId={ptyId} authToken={authToken} />
      </div>
    </div>
  );
}
