import { ChevronLeft, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PtyTerminal } from '../../components/PtyTerminal';
import { AgentGlobalComposer, type AgentGlobalComposerTarget } from '../../components/AgentGlobalComposer';
import { DEFAULT_EMBEDDED_RUNTIME_PORT } from '@/config/runtime-target';
import type { SessionInfo, UpdateSessionRequest } from '@/lib/types/session';
import { sendPtyTextInput } from '@/ui/app/components/pty-input';

function appendTerminalCarriageReturn(text: string): string {
  return text.endsWith('\r') ? text : `${text}\r`;
}

export function PtyTerminalPage({ ptyId }: { ptyId?: string }) {
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const [isCheckingPty, setIsCheckingPty] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
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
  const buildHeaders = (includeJsonContentType = false): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (includeJsonContentType) {
      headers['Content-Type'] = 'application/json';
    }
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    return headers;
  };

  useEffect(() => {
    if (!ptyId) {
      setIsCheckingPty(false);
      setIsDisconnected(false);
      return;
    }

    let disposed = false;

    const verifyPty = async () => {
      setIsCheckingPty(true);
      setIsDisconnected(false);

      try {
        const response = await fetch(`${rtBaseUrl}/pty`, { headers: buildHeaders() });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const ptyAgents = await response.json() as Array<{ id: string }>;
        if (!disposed) {
          setIsDisconnected(!ptyAgents.some((agent) => agent.id === ptyId));
        }
      } catch {
        if (!disposed) {
          setIsDisconnected(true);
        }
      } finally {
        if (!disposed) {
          setIsCheckingPty(false);
        }
      }
    };

    void verifyPty();

    return () => {
      disposed = true;
    };
  }, [authToken, ptyId, rtBaseUrl]);

  const navigateBack = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/agents');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const recoverDisconnectedSession = async (): Promise<boolean> => {
    if (!ptyId) return false;

    const sessionsResponse = await fetch(`${rtBaseUrl}/sessions`, {
      headers: buildHeaders(),
    });
    if (!sessionsResponse.ok) {
      throw new Error(`HTTP ${sessionsResponse.status}`);
    }

    const sessions = await sessionsResponse.json() as SessionInfo[];
    let matchingSession = sessions.find((session) => (
      session.interaction_mode === 'terminal'
      && session.pty_id === ptyId
    ));

    if (!matchingSession) {
      return false;
    }

    const recoverySteps: UpdateSessionRequest[] = [];
    if (matchingSession.status === 'running') {
      recoverySteps.push({ status: 'completed' });
    } else if (
      matchingSession.status === 'waiting_input'
      || matchingSession.status === 'paused'
      || matchingSession.status === 'error'
    ) {
      recoverySteps.push({ status: 'running' }, { status: 'completed' });
    } else if (matchingSession.status === 'completed') {
      return true;
    } else {
      return false;
    }

    for (const step of recoverySteps) {
      const response = await fetch(`${rtBaseUrl}/sessions/${encodeURIComponent(matchingSession.id)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(step),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      matchingSession = await response.json() as SessionInfo;
    }

    return true;
  };

  const handleStop = async () => {
    if (!ptyId || isStopping || isCheckingPty) return;
    setIsStopping(true);
    setStopError('');

    try {
      const response = await fetch(`${rtBaseUrl}/pty/${encodeURIComponent(ptyId)}/stop`, {
        method: 'POST',
        headers: buildHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          const recovered = await recoverDisconnectedSession();
          if (recovered) {
            navigateBack();
            return;
          }
        }
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

  const activeComposerTarget = useMemo<AgentGlobalComposerTarget | null>(() => {
    if (!ptyId || isDisconnected) {
      return null;
    }

    return {
      kind: 'pty',
      label: ptyId,
      placeholder: '输入命令或提示，Enter 发送到当前终端',
      description: 'Ctrl+Space 转写会写入这里，并发送到当前终端',
      send: async (content: string) => {
        const response = await sendPtyTextInput({
          rtBaseUrl,
          ptyId,
          authToken,
        }, appendTerminalCarriageReturn(content));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      },
    };
  }, [authToken, isDisconnected, ptyId, rtBaseUrl]);

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
          disabled={isStopping || isCheckingPty}
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
        {isDisconnected ? (
          <div
            data-testid="pty-terminal-page-disconnected"
            className="flex h-full flex-col bg-[#1C1917]"
          >
            <div className="border-b border-[#292524] px-6 py-4 text-center">
              <p className="text-sm font-semibold text-[#FAFAF9]">终端已断开</p>
              <p className="mt-1 text-xs text-[#A8A29E]">
                对应 PTY 已不存在，RT 可能已经重启。下方保留关闭前历史；如需结束，可点击上方“结束”将会话收敛为已完成。
              </p>
            </div>
            <div className="flex-1 overflow-hidden">
              <PtyTerminal
                rtBaseUrl={rtBaseUrl}
                ptyId={ptyId}
                authToken={authToken}
                interactive={false}
              />
            </div>
            <div className="border-t border-[#292524] px-4 py-3">
              <button
                type="button"
                onClick={navigateBack}
                className="rounded border border-[#44403C] px-3 py-1.5 text-xs text-[#E7E5E4] hover:border-[#57534E]"
              >
                返回 Agents
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <PtyTerminal
                rtBaseUrl={rtBaseUrl}
                ptyId={ptyId}
                authToken={authToken}
                onInitialConnectionFailure={() => {
                  setIsDisconnected(true);
                }}
              />
            </div>
            <AgentGlobalComposer target={activeComposerTarget} variant="terminal" />
          </div>
        )}
      </div>
    </div>
  );
}
