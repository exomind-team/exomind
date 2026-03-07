import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getRuntimeMeshSyncService } from '@/lib/services/runtime-mesh-sync.service';
import { Loader2, RefreshCw, Check, X } from 'lucide-react';

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
}

// ── Component ──────────────────────────────────────────────────

export function PeerPairingDialog({
  open,
  onOpenChange,
  runtimeBaseUrl,
  localHostId,
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
      const result = await meshService.initiatePairing(runtimeBaseUrl);
      setSessionId(result.session_id);
      setPin(result.pin);
      setStatus('waiting');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [meshService, runtimeBaseUrl]);

  // ── Responder flow ──────────────────────────────────────────

  const handleResponderMode = useCallback(() => {
    setMode('responder');
    setStatus('loading');
    setErrorMessage('');

    // Start polling for discovered peers
    const poll = async () => {
      try {
        const discovered = await meshService.listDiscoveredPeers(runtimeBaseUrl);
        setPeers(discovered);
        if (status === 'loading') {
          setStatus('idle');
        }
      } catch {
        // Silent retry on poll failure
      }
    };

    void poll();
    pollTimerRef.current = setInterval(poll, 3000);
  }, [meshService, runtimeBaseUrl, status]);

  const handleRefreshPeers = useCallback(async () => {
    try {
      const discovered = await meshService.listDiscoveredPeers(runtimeBaseUrl);
      setPeers(discovered);
    } catch {
      // Silently ignore refresh errors
    }
  }, [meshService, runtimeBaseUrl]);

  const handleSelectPeer = useCallback((peer: DiscoveredPeer) => {
    setSelectedPeer(peer);
    setPinInput('');
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
      const targetUrl = `http://${selectedPeer.host}:${selectedPeer.port}`;
      const result = await meshService.respondToPairing(
        targetUrl,
        '', // session_id will be looked up server-side by host_id
        pinInput,
        localHostId,
        runtimeBaseUrl,
      );
      if (result.paired) {
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
  }, [selectedPeer, pinInput, meshService, localHostId, runtimeBaseUrl]);

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
      <DialogContent className="sm:max-w-md">
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
          <div className="flex flex-col gap-3 pt-2">
            <Button onClick={handleInitiate} variant="outline" className="justify-start gap-3 h-auto py-3">
              <div className="text-left">
                <div className="font-medium">发起配对</div>
                <div className="text-xs text-muted-foreground">生成 PIN 码，等待其他设备输入</div>
              </div>
            </Button>
            <Button onClick={handleResponderMode} variant="outline" className="justify-start gap-3 h-auto py-3">
              <div className="text-left">
                <div className="font-medium">响应配对</div>
                <div className="text-xs text-muted-foreground">扫描局域网设备，输入对方的 PIN 码</div>
              </div>
            </Button>
          </div>
        )}

        {/* ── Initiator: PIN Display ── */}
        {mode === 'initiator' && (
          <div className="flex flex-col items-center gap-4 py-4">
            {status === 'loading' && (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            )}
            {status === 'waiting' && (
              <>
                <div className="flex gap-2">
                  {pin.split('').map((digit, i) => (
                    <div
                      key={i}
                      className="flex h-14 w-11 items-center justify-center rounded-lg border-2 border-primary bg-muted text-2xl font-bold tabular-nums"
                    >
                      {digit}
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  在对方设备的「响应配对」中输入此 PIN 码
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  等待对方连接...
                </div>
              </>
            )}
            {status === 'error' && (
              <div className="flex flex-col items-center gap-2">
                <X className="h-8 w-8 text-destructive" />
                <p className="text-sm text-destructive">{errorMessage}</p>
                <Button variant="outline" size="sm" onClick={handleInitiate}>
                  重试
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Responder: Peer List ── */}
        {mode === 'responder' && !selectedPeer && (
          <div className="flex flex-col gap-3 py-2">
            {status === 'loading' && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {peers.length === 0 && status !== 'loading' && (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                <p>未发现局域网设备</p>
                <p className="text-xs">请确保对方设备已启动 Runtime</p>
              </div>
            )}
            {peers.map((peer) => (
              <Button
                key={peer.host_id}
                variant="outline"
                className="justify-start gap-3 h-auto py-3"
                onClick={() => handleSelectPeer(peer)}
              >
                <div className="text-left">
                  <div className="font-medium font-mono text-xs">{peer.host_id.slice(0, 12)}...</div>
                  <div className="text-xs text-muted-foreground">
                    {peer.host}:{peer.port}
                  </div>
                </div>
              </Button>
            ))}
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setMode('select')}>
                返回
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRefreshPeers}>
                <RefreshCw className="h-4 w-4 mr-1" />
                刷新
              </Button>
            </div>
          </div>
        )}

        {/* ── Responder: PIN Input ── */}
        {mode === 'responder' && selectedPeer && status !== 'success' && (
          <div className="flex flex-col items-center gap-4 py-4">
            {status === 'loading' && (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            )}
            {(status === 'idle' || status === 'error') && (
              <>
                <div className="flex gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Input
                      key={i}
                      ref={(el) => { pinInputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={pinInput[i] ?? ''}
                      onChange={(e) => handlePinDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(i, e)}
                      className="h-14 w-11 text-center text-2xl font-bold tabular-nums"
                    />
                  ))}
                </div>
                {status === 'error' && (
                  <p className="text-sm text-destructive">{errorMessage}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedPeer(null);
                      setPinInput('');
                      setStatus('idle');
                      setErrorMessage('');
                    }}
                  >
                    返回
                  </Button>
                  <Button
                    size="sm"
                    disabled={pinInput.length !== 6}
                    onClick={handleSubmitPin}
                  >
                    确认配对
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Responder: Success ── */}
        {mode === 'responder' && status === 'success' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Check className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium">配对成功</p>
            {peerToken && (
              <p className="text-xs text-muted-foreground font-mono break-all max-w-full">
                Token: {peerToken.slice(0, 16)}...
              </p>
            )}
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
