import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PtyTerminal } from '../../components/PtyTerminal';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { DEFAULT_EMBEDDED_RUNTIME_PORT } from '@/config/runtime-target';

export function PtyTerminalPage({ ptyId }: { ptyId?: string }) {
  const [rtBaseUrl, setRtBaseUrl] = useState(`http://127.0.0.1:${DEFAULT_EMBEDDED_RUNTIME_PORT}`);
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    const resolve = async () => {
      try {
        const hosts = await getRuntimeHostService().listHosts();
        if (hosts.length > 0 && !disposed) {
          const host = hosts[0];
          setRtBaseUrl(`http://${host.host}:${host.port}`);
          if (host.authToken) setAuthToken(host.authToken);
        }
      } catch {
        // fallback already set
      }
    };
    void resolve();
    return () => { disposed = true; };
  }, []);

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
