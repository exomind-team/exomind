import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getRuntimeMeshSyncService } from '@/lib/services/runtime-mesh-sync.service';
import { formatHostForUrl } from '@/config/runtime-target';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { Loader2, RefreshCw, Check, X, ChevronLeft } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

type PairingMode = 'select' | 'initiator' | 'responder';
type PairingStatus = 'idle' | 'loading' | 'waiting' | 'success' | 'error';

interface DiscoveredPeer {
  host_id: string;
  host: string;
  port: number;
}

export interface PeerPairingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtimeBaseUrl: string;
  localHostId: string;
  /** Admin auth token for the local runtime (required when EXOMIND_RT_SECRET is set). */
  localAuthToken?: string;
}

function buildInitiatorDiagnosticMessage(
  runtimeBaseUrl: string,
  localHostId: string,
  localAuthToken: string | undefined,
  err: unknown,
): string {
  const reason = err instanceof Error ? err.message : String(err);
  return [
    '发起配对失败',
    `runtime=${runtimeBaseUrl}`,
    `hostId=${localHostId || 'unknown'}`,
    `auth=${localAuthToken ? 'present' : 'missing'}`,
    reason,
  ].join('\n');
}

// ── Component ──────────────────────────────────────────────────

export function PeerPairingDialog({
  open,
  onOpenChange,
  runtimeBaseUrl,
  localHostId,
  localAuthToken,
}: PeerPairingDialogProps) {
  const [mode, setMode] = useState<PairingMode>('select');
  const [status, setStatus] = useState<PairingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Initiator state
  // sessionId is stored for future use (e.g. cancellation, status polling)
  const [_sessionId, setSessionId] = useState('');
  const [pin, setPin] = useState('');

  // Responder state
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<DiscoveredPeer | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [peerToken, setPeerToken] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const meshService = getRuntimeMeshSyncService();

  // ── Reset on close ──────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      setMode('select');
      setStatus('idle');
      setErrorMessage('');
      setSessionId('');
      setPin('');
      setPeers([]);
      setSelectedPeer(null);
      setPinInput('');
      setPeerToken('');
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [open]);

  // ── Cleanup poll timer on unmount ───────────────────────────

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  // ── Initiator flow ──────────────────────────────────────────

  const handleInitiate = useCallback(async () => {
    setMode('initiator');
    setStatus('loading');
    setErrorMessage('');
    try {
      const result = await meshService.initiatePairing(runtimeBaseUrl, localAuthToken);
      setSessionId(result.session_id);
      setPin(result.pin);
      setStatus('waiting');

      // Start polling for pairing completion
      const initialPeers = await meshService.listMeshPeers(runtimeBaseUrl, localAuthToken).catch(() => []);
      const initialPeerIds = new Set(initialPeers.map((p: { id: string }) => p.id));

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      pollTimerRef.current = setInterval(async () => {
        try {
          const currentPeers = await meshService.listMeshPeers(runtimeBaseUrl, localAuthToken);
          const newPeer = currentPeers.find((p: { id: string }) => !initialPeerIds.has(p.id));
          if (newPeer) {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setStatus('success');
          }
        } catch {
          // Silently retry
        }
      }, 2000);
    } catch (err) {
      setErrorMessage(
        buildInitiatorDiagnosticMessage(runtimeBaseUrl, localHostId, localAuthToken, err),
      );
      setStatus('error');
    }
  }, [meshService, runtimeBaseUrl, localAuthToken, localHostId]);

  // ── Responder flow ──────────────────────────────────────────

  const handleResponderMode = useCallback(() => {
    setMode('responder');
    setStatus('loading');
    setErrorMessage('');
    setSelectedPeer(null);
    setPeers([]);

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    // Start polling for discovered peers
    const poll = async () => {
      try {
        const discovered = await meshService.listDiscoveredPeers(runtimeBaseUrl, localAuthToken);
        setPeers(discovered);
        setStatus((currentStatus) => (currentStatus === 'loading' ? 'idle' : currentStatus));
      } catch {
        // Silent retry on poll failure
      }
    };

    void poll();
    pollTimerRef.current = setInterval(poll, 3000);
  }, [meshService, runtimeBaseUrl, localAuthToken]);

  const handleRefreshPeers = useCallback(async () => {
    try {
      const discovered = await meshService.listDiscoveredPeers(runtimeBaseUrl, localAuthToken);
      setPeers(discovered);
    } catch {
      // Silently ignore refresh errors
    }
  }, [meshService, runtimeBaseUrl, localAuthToken]);

  const handleSelectPeer = useCallback((peer: DiscoveredPeer) => {
    setSelectedPeer(peer);
    setPinInput('');
    setErrorMessage('');
    setStatus('idle');
  }, []);

  const handleSubmitPin = useCallback(async () => {
    if (!selectedPeer || pinInput.length !== 6) return;

    setStatus('loading');
    setErrorMessage('');

    // Stop polling while submitting
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    try {
      // Generate a per-peer inbound token for the initiator to use when calling us.
      const responderInboundToken = crypto.randomUUID();

      const initiatorBaseUrl = `http://${formatHostForUrl(selectedPeer.host)}:${selectedPeer.port}`;

      // Determine our externally-reachable address (what the initiator should use to call us)
      let responderBaseUrl = runtimeBaseUrl;
      try {
        const reachable = await getRuntimeControlService().getReachableAddress(
          selectedPeer.host,
          selectedPeer.port,
        );
        if (reachable.host) {
          responderBaseUrl = `http://${formatHostForUrl(reachable.host)}:${reachable.port}`;
        }
      } catch {
        // Fall back to runtimeBaseUrl if reachable address resolution fails
      }

      const result = await meshService.respondToPairing(
        initiatorBaseUrl,
        '', // session_id will be looked up server-side by host_id
        pinInput,
        localHostId,
        responderBaseUrl,
        responderInboundToken,
      );
      if (result.paired) {
        // Register the initiator as a peer on the local runtime.
        await meshService.registerPeerLocally(
          runtimeBaseUrl,
          selectedPeer.host_id,
          initiatorBaseUrl,
          result.initiator_inbound_token, // outbound: what we send to the initiator
          responderInboundToken,           // inbound: what the initiator sends to us
          localAuthToken,
        );

        setPeerToken(result.peer_token);
        setStatus('success');
      } else {
        setErrorMessage('PIN 验证失败，请确认后重试');
        setStatus('error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [selectedPeer, pinInput, meshService, localHostId, runtimeBaseUrl, localAuthToken]);

  // ── PIN input handler with auto-advance ─────────────────────

  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handlePinDigitChange = useCallback(
    (index: number, value: string) => {
      // Only accept single digits
      const digit = value.replace(/[^0-9]/g, '').slice(-1);
      const chars = pinInput.split('');
      while (chars.length < 6) chars.push('');
      chars[index] = digit;
      const newPin = chars.join('').slice(0, 6);
      setPinInput(newPin);

      // Auto-advance to next input
      if (digit && index < 5) {
        pinInputRefs.current[index + 1]?.focus();
      }
    },
    [pinInput],
  );

  const handlePinKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !pinInput[index] && index > 0) {
        pinInputRefs.current[index - 1]?.focus();
      }
    },
    [pinInput],
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'select' && '设备配对'}
            {mode === 'initiator' && '等待对方输入 PIN'}
            {mode === 'responder' && (selectedPeer ? '输入 PIN 码' : '发现的设备')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'select' && '选择配对模式，与其他 ExoMind 设备建立安全连接'}
            {mode === 'initiator' && '请在对方设备上输入以下 PIN 码完成配对'}
            {mode === 'responder' && (selectedPeer ? `正在与 ${selectedPeer.host_id.slice(0, 8)}... 配对` : '通过 mDNS 自动发现的局域网设备')}
          </DialogDescription>
        </DialogHeader>

        {/* ── Mode Selection ── */}
        {mode === 'select' && (
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={handleInitiate}
              className="flex w-full items-center rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <div>
                <div className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">发起配对</div>
                <div className="mt-0.5 text-xs text-[#A8A29E]">生成 PIN 码，等待其他设备输入</div>
              </div>
            </button>
            <button
              type="button"
              onClick={handleResponderMode}
              className="flex w-full items-center rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
            >
              <div>
                <div className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">响应配对</div>
                <div className="mt-0.5 text-xs text-[#A8A29E]">扫描局域网设备，输入对方的 PIN 码</div>
              </div>
            </button>
          </div>
        )}

        {/* ── Initiator: PIN Display ── */}
        {mode === 'initiator' && (
          <div className="flex flex-col items-center gap-4 py-4">
            {status === 'loading' && (
              <Loader2 className="h-8 w-8 animate-spin text-[#A8A29E]" />
            )}
            {status === 'waiting' && (
              <>
                <div className="flex gap-2">
                  {pin.split('').map((digit, i) => (
                    <div
                      key={i}
                      className="flex h-14 w-11 items-center justify-center rounded-xl border-2 border-[#C75B3A] bg-[#FAF7F5] text-2xl font-bold tabular-nums text-[#1C1917] dark:bg-[#292524] dark:text-[#FAFAF9]"
                    >
                      {digit}
                    </div>
                  ))}
                </div>
                <p className="text-sm text-[#78716C]">
                  在对方设备的「响应配对」中输入此 PIN 码
                </p>
                <div className="flex items-center gap-2 text-xs text-[#A8A29E]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  等待对方连接...
                </div>
              </>
            )}
            {status === 'error' && (
              <div className="flex flex-col items-center gap-2">
                <X className="h-8 w-8 text-red-500" />
                <p className="text-sm text-red-500">{errorMessage}</p>
                <button
                  type="button"
                  onClick={handleInitiate}
                  className="rounded-xl border border-[#F0ECE8] px-4 py-2 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
                >
                  重试
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Responder: Peer List ── */}
        {mode === 'responder' && !selectedPeer && (
          <div className="flex flex-col gap-3 py-2">
            {status === 'loading' && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-[#A8A29E]" />
              </div>
            )}
            {peers.length === 0 && status !== 'loading' && (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-[#78716C]">
                <p>未发现局域网设备</p>
                <p className="text-xs text-[#A8A29E]">请确保对方设备已启动 Runtime</p>
              </div>
            )}
            {peers.map((peer) => (
              <button
                key={peer.host_id}
                type="button"
                className="flex w-full items-center rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
                onClick={() => handleSelectPeer(peer)}
              >
                <div>
                  <div className="font-medium font-mono text-xs text-[#1C1917] dark:text-[#FAFAF9]">{peer.host_id.slice(0, 12)}...</div>
                  <div className="mt-0.5 text-xs text-[#A8A29E]">
                    {peer.host}:{peer.port}
                  </div>
                </div>
              </button>
            ))}
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setMode('select')}
                className="flex items-center gap-1 text-sm text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
              >
                <ChevronLeft className="h-4 w-4" />
                返回
              </button>
              <button
                type="button"
                onClick={handleRefreshPeers}
                className="flex items-center gap-1 text-sm text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
          </div>
        )}

        {/* ── Responder: PIN Input ── */}
        {mode === 'responder' && selectedPeer && status !== 'success' && (
          <div className="flex flex-col items-center gap-4 py-4">
            {status === 'loading' && (
              <Loader2 className="h-8 w-8 animate-spin text-[#A8A29E]" />
            )}
            {(status === 'idle' || status === 'error') && (
              <>
                <div className="flex gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <input
                      key={i}
                      ref={(el) => { pinInputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={pinInput[i] ?? ''}
                      onChange={(e) => handlePinDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(i, e)}
                      className="h-14 w-11 rounded-xl border border-[#F0ECE8] bg-white text-center text-2xl font-bold tabular-nums text-[#1C1917] outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
                    />
                  ))}
                </div>
                {status === 'error' && (
                  <p className="text-sm text-red-500">{errorMessage}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPeer(null);
                      setPinInput('');
                      setStatus('idle');
                      setErrorMessage('');
                    }}
                    className="rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
                  >
                    返回
                  </button>
                  <button
                    type="button"
                    disabled={pinInput.length !== 6}
                    onClick={handleSubmitPin}
                    className="rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    确认配对
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Success (both modes) ── */}
        {status === 'success' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Check className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">配对成功</p>
            {peerToken && (
              <p className="text-xs text-[#A8A29E] font-mono break-all max-w-full">
                Token: {peerToken.slice(0, 16)}...
              </p>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl bg-[#C75B3A] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
            >
              完成
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
