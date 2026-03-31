import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getRuntimeMeshSyncService } from '@/lib/services/runtime-mesh-sync.service';
import { formatHostForUrl, parseRuntimeAddress } from '@/config/runtime-target';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { Loader2, RefreshCw, Check, X, ChevronLeft } from 'lucide-react';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { resolveRuntimeHostDialAddress } from '@/lib/utils/runtime-host-address';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import {
  createRuntimeLinkProofService,
  type RuntimeLinkProofRunOptions,
} from '@/lib/services/runtime-link-proof.service';
import type { SignalEvent } from '@/lib/types/signal-pool';

// ── Types ──────────────────────────────────────────────────────

type PairingMode = 'select' | 'initiator' | 'responder';
type PairingStatus =
  | 'idle'
  | 'loading'
  | 'waiting'
  | 'verifying_pending'
  | 'verifying'
  | 'verification_failed'
  | 'success'
  | 'error';

interface DiscoveredPeer {
  host_id: string;
  host: string;
  port: number;
}

interface ResponderPeer extends DiscoveredPeer {
  sourceLabel: string;
  priority: number;
  dialHost?: string;
  dialPort?: number;
}

type VerificationContext = Omit<RuntimeLinkProofRunOptions, 'trigger'> & {
  trigger: 'pairing_auto' | 'manual_retry';
};

const INITIATOR_PEER_POLL_INTERVAL_MS = 2000;
const RESPONDER_DISCOVERY_POLL_INTERVAL_MS = 3000;
const ADOPTION_POLL_INTERVAL_MS = 250;
const ADOPTION_WINDOW_MS = 5000;

export interface PeerPairingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtimeBaseUrl: string;
  localHostId: string;
  /** Admin auth token for the local runtime (required when EXOMIND_RT_SECRET is set). */
  localAuthToken?: string;
  /** Known online hosts from the device page（设备页里当前已知且在线的设备）. */
  knownHosts?: RuntimeHostRecord[];
  onPairingSuccess?: () => Promise<void> | void;
  timingOverrides?: {
    initiatorPeerPollIntervalMs?: number;
    responderDiscoveryPollIntervalMs?: number;
    adoptionPollIntervalMs?: number;
    adoptionWindowMs?: number;
  };
}

function buildResponderPeerKey(peer: Pick<DiscoveredPeer, 'host_id' | 'host' | 'port'>): string {
  return peer.host_id || `${peer.host}:${peer.port}`;
}

function normalizeResponderSourceLabel(labels: Iterable<string>): string {
  return Array.from(new Set(labels)).join(' · ');
}

function getKnownHostPeerLabel(host: RuntimeHostRecord): string {
  if (host.trustState === 'confirmed_peer') {
    return '已连接';
  }
  if (host.trustState === 'discovered_candidate') {
    return '已知设备';
  }
  return '已保存设备';
}

function getKnownHostPriority(host: RuntimeHostRecord): number {
  if (host.trustState === 'confirmed_peer') {
    return 0;
  }
  if (host.trustState === 'discovered_candidate') {
    return 1;
  }
  return 2;
}

function buildResponderPeers(
  discoveredPeers: DiscoveredPeer[],
  knownHosts: RuntimeHostRecord[],
  localHostId: string,
): ResponderPeer[] {
  const peers = new Map<string, ResponderPeer>();

  const upsertPeer = (
    peer: DiscoveredPeer,
    sourceLabel: string,
    priority: number,
    dialAddress?: { host: string; port: number },
  ) => {
    const key = buildResponderPeerKey(peer);
    const existing = peers.get(key);
    if (!existing) {
      peers.set(key, {
        ...peer,
        sourceLabel,
        priority,
        dialHost: dialAddress?.host,
        dialPort: dialAddress?.port,
      });
      return;
    }

    peers.set(key, {
      host_id: existing.host_id || peer.host_id,
      host: existing.host || peer.host,
      port: existing.port || peer.port,
      sourceLabel: normalizeResponderSourceLabel([
        ...existing.sourceLabel.split(' · '),
        sourceLabel,
      ]),
      priority: Math.min(existing.priority, priority),
      dialHost: dialAddress?.host ?? existing.dialHost,
      dialPort: dialAddress?.port ?? existing.dialPort,
    });
  };

  for (const peer of discoveredPeers) {
    if (!peer.host_id || peer.host_id === localHostId) {
      continue;
    }
    upsertPeer(peer, '自动发现', 2);
  }

  for (const host of knownHosts) {
    if (!host.hostId || host.hostId === localHostId) {
      continue;
    }

    let dialAddress: { host: string; port: number };
    try {
      dialAddress = parseRuntimeAddress(resolveRuntimeHostDialAddress(host));
    } catch {
      continue;
    }

    upsertPeer(
      {
        host_id: host.hostId,
        host: host.host,
        port: host.port,
      },
      getKnownHostPeerLabel(host),
      getKnownHostPriority(host),
      dialAddress,
    );
  }

  return Array.from(peers.values()).sort((left, right) => (
    left.priority - right.priority
    || left.host_id.localeCompare(right.host_id)
    || left.host.localeCompare(right.host)
    || left.port - right.port
  ));
}

function resolveAndroidEmulatorHostAlias(host: string): string | null {
  if (host.startsWith('10.0.2.')) {
    return '10.0.2.2';
  }
  if (host.startsWith('10.0.3.')) {
    return '10.0.3.2';
  }
  return null;
}

function resolveResponderPeerDisplayAddress(peer: ResponderPeer): string {
  const host = peer.dialHost ?? peer.host;
  const port = peer.dialPort ?? peer.port;
  return `${host}:${port}`;
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

function buildLocalRuntimeHost(
  runtimeBaseUrl: string,
  localHostId: string,
  localAuthToken?: string,
): RuntimeHostRecord {
  const parsed = new URL(runtimeBaseUrl);
  const port = Number.parseInt(parsed.port || '80', 10);

  return {
    id: 'runtime-host-local-proof',
    name: `Local Runtime (${parsed.hostname}:${port})`,
    host: parsed.hostname,
    port,
    status: 'online',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    isLocal: true,
    hostId: localHostId,
    trustState: 'manual_seed',
    authToken: localAuthToken,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIncomingProofRequest(
  event: SignalEvent,
  peerId: string,
  localHostId: string,
  minTs: number,
): boolean {
  if (event.topic !== 'system.link_proof.request' || event.ts < minTs) {
    return false;
  }
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return record.initiated_by_peer_id === peerId && record.target_peer_id === localHostId;
}

// ── Component ──────────────────────────────────────────────────

export function PeerPairingDialog({
  open,
  onOpenChange,
  runtimeBaseUrl,
  localHostId,
  localAuthToken,
  knownHosts = [],
  onPairingSuccess,
  timingOverrides,
}: PeerPairingDialogProps) {
  const [mode, setMode] = useState<PairingMode>('select');
  const [status, setStatus] = useState<PairingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Initiator state
  // sessionId is stored for future use (e.g. cancellation, status polling)
  const [_sessionId, setSessionId] = useState('');
  const [pin, setPin] = useState('');

  // Responder state
  const [discoveredPeers, setDiscoveredPeers] = useState<DiscoveredPeer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<ResponderPeer | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [peerToken, setPeerToken] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verificationContextRef = useRef<VerificationContext | null>(null);
  const pairingStartedAtRef = useRef<number>(0);

  const meshService = getRuntimeMeshSyncService();
  const hostService = getRuntimeHostService();
  const localSignalService = useMemo(() => new SignalStreamService({
    host: buildLocalRuntimeHost(runtimeBaseUrl, localHostId, localAuthToken),
  }), [runtimeBaseUrl, localHostId, localAuthToken]);
  const linkProofService = useMemo(() => createRuntimeLinkProofService({
    signalService: localSignalService,
    hostService,
  }), [localSignalService, hostService]);
  const initiatorPeerPollIntervalMs = timingOverrides?.initiatorPeerPollIntervalMs ?? INITIATOR_PEER_POLL_INTERVAL_MS;
  const responderDiscoveryPollIntervalMs = timingOverrides?.responderDiscoveryPollIntervalMs ?? RESPONDER_DISCOVERY_POLL_INTERVAL_MS;
  const adoptionPollIntervalMs = timingOverrides?.adoptionPollIntervalMs ?? ADOPTION_POLL_INTERVAL_MS;
  const adoptionWindowMs = timingOverrides?.adoptionWindowMs ?? ADOPTION_WINDOW_MS;
  const responderPeers = useMemo(
    () => buildResponderPeers(discoveredPeers, knownHosts, localHostId),
    [discoveredPeers, knownHosts, localHostId],
  );

  // ── Reset on close ──────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      setMode('select');
      setStatus('idle');
      setErrorMessage('');
      setSessionId('');
      setPin('');
      setDiscoveredPeers([]);
      setSelectedPeer(null);
      setPinInput('');
      setPeerToken('');
      verificationContextRef.current = null;
      pairingStartedAtRef.current = 0;
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

  const waitForConfirmedHostRecord = useCallback(async (peerId: string) => {
    const deadline = Date.now() + adoptionWindowMs;
    while (Date.now() <= deadline) {
      const hosts = await hostService.listHosts();
      const host = hosts.find((item) => item.hostId === peerId && item.trustState === 'confirmed_peer')
        ?? hosts.find((item) => item.hostId === peerId);
      if (host) {
        return host;
      }
      await sleep(adoptionPollIntervalMs);
    }
    return null;
  }, [adoptionPollIntervalMs, adoptionWindowMs, hostService]);

  const waitForIncomingProofRequest = useCallback(async (peerId: string, minTs: number) => {
    const deadline = Date.now() + adoptionWindowMs;
    let cursor: string | undefined;

    while (Date.now() <= deadline) {
      const events = await localSignalService.history({
        limit: 50,
        topicPrefix: 'system.link_proof.',
        afterEventId: cursor,
      });

      if (events.length > 0) {
        cursor = events[events.length - 1]?.id;
      }

      const requestEvent = events.find((event) => isIncomingProofRequest(
        event,
        peerId,
        localHostId,
        minTs,
      ));
      if (requestEvent) {
        return requestEvent;
      }

      await sleep(adoptionPollIntervalMs);
    }

    return null;
  }, [adoptionPollIntervalMs, adoptionWindowMs, localSignalService, localHostId]);

  const runVerification = useCallback(async (
    context: VerificationContext,
    options?: { afterSuccess?: () => Promise<void> | void },
  ) => {
    verificationContextRef.current = context;
    setStatus('verifying');
    setErrorMessage('');

    const result = await linkProofService.runVerification(context);
    if (result.status === 'verified') {
      setStatus('success');
      await options?.afterSuccess?.();
      return result;
    }

    setErrorMessage(result.errorMessage);
    setStatus('verification_failed');
    return result;
  }, [linkProofService]);

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
      pairingStartedAtRef.current = Date.now();

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
            setStatus('verifying_pending');
            await onPairingSuccess?.();

            const [hostRecord, adoptedRequestEvent] = await Promise.all([
              waitForConfirmedHostRecord(newPeer.id),
              waitForIncomingProofRequest(newPeer.id, pairingStartedAtRef.current),
            ]);

            if (!hostRecord || !adoptedRequestEvent) {
              setErrorMessage('等待验证上下文超时');
              setStatus('verification_failed');
              return;
            }

            await runVerification({
              mode: 'joiner',
              localPeerId: localHostId,
              peerId: newPeer.id,
              runtimeHostRecordId: hostRecord.id,
              adoptedRequestEvent,
              trigger: 'pairing_auto',
            }, {
              afterSuccess: onPairingSuccess,
            });
          }
        } catch {
          // Silently retry
        }
      }, initiatorPeerPollIntervalMs);
    } catch (err) {
      setErrorMessage(
        buildInitiatorDiagnosticMessage(runtimeBaseUrl, localHostId, localAuthToken, err),
      );
      setStatus('error');
    }
  }, [
    meshService,
    runtimeBaseUrl,
    localAuthToken,
    localHostId,
    onPairingSuccess,
    runVerification,
    waitForConfirmedHostRecord,
    waitForIncomingProofRequest,
    initiatorPeerPollIntervalMs,
  ]);

  // ── Responder flow ──────────────────────────────────────────

  const handleResponderMode = useCallback(() => {
    setMode('responder');
    setStatus('loading');
    setErrorMessage('');
    setSelectedPeer(null);
    setDiscoveredPeers([]);

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    // Start polling for discovered peers
    const poll = async () => {
      try {
        const discovered = await meshService.listDiscoveredPeers(runtimeBaseUrl, localAuthToken);
        setDiscoveredPeers(discovered);
        setStatus((currentStatus) => (currentStatus === 'loading' ? 'idle' : currentStatus));
      } catch {
        // Silent retry on poll failure
      }
    };

    void poll();
    pollTimerRef.current = setInterval(poll, responderDiscoveryPollIntervalMs);
  }, [meshService, runtimeBaseUrl, localAuthToken, responderDiscoveryPollIntervalMs]);

  const handleRefreshPeers = useCallback(async () => {
    try {
      const discovered = await meshService.listDiscoveredPeers(runtimeBaseUrl, localAuthToken);
      setDiscoveredPeers(discovered);
    } catch {
      // Silently ignore refresh errors
    }
  }, [meshService, runtimeBaseUrl, localAuthToken]);

  const handleSelectPeer = useCallback((peer: ResponderPeer) => {
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

      let initiatorBaseUrl = `http://${formatHostForUrl(selectedPeer.host)}:${selectedPeer.port}`;
      try {
        const dialAddress = await getRuntimeControlService().getPeerDialAddress(
          selectedPeer.host,
          selectedPeer.port,
        );
        initiatorBaseUrl = `http://${formatHostForUrl(dialAddress.host)}:${dialAddress.port}`;
      } catch {
        // Prefer the locally-known dial override（优先复用本机已知拨号地址）.
        if (selectedPeer.dialHost && selectedPeer.dialPort) {
          initiatorBaseUrl = `http://${formatHostForUrl(selectedPeer.dialHost)}:${selectedPeer.dialPort}`;
        }
      }

      // Determine our externally-reachable address (what the initiator should use to call us)
      let responderBaseUrl = runtimeBaseUrl;
      const emulatorHostAlias = resolveAndroidEmulatorHostAlias(selectedPeer.host);
      if (emulatorHostAlias) {
        // Android emulator guests must call the host via 10.0.2.2 / 10.0.3.2,
        // never via loopback / proxy bridge aliases（模拟器回拨桌面必须走 host alias）.
        const runtimeUrl = new URL(runtimeBaseUrl);
        const runtimePort = Number.parseInt(runtimeUrl.port || '80', 10);
        responderBaseUrl = `http://${formatHostForUrl(emulatorHostAlias)}:${runtimePort}`;
      } else {
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
        setStatus('verifying');
        await onPairingSuccess?.();

        const hostRecord = await waitForConfirmedHostRecord(selectedPeer.host_id);
        if (!hostRecord) {
          setErrorMessage('未找到已配对设备记录，无法开始验证');
          setStatus('verification_failed');
          return;
        }

        await runVerification({
          mode: 'owner',
          localPeerId: localHostId,
          peerId: selectedPeer.host_id,
          runtimeHostRecordId: hostRecord.id,
          trigger: 'pairing_auto',
        }, {
          afterSuccess: onPairingSuccess,
        });
      } else {
        setErrorMessage('PIN 验证失败，请确认后重试');
        setStatus('error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [
    selectedPeer,
    pinInput,
    meshService,
    localHostId,
    runtimeBaseUrl,
    localAuthToken,
    onPairingSuccess,
    runVerification,
    waitForConfirmedHostRecord,
  ]);

  const handleRetryVerification = useCallback(async () => {
    const context = verificationContextRef.current;
    if (!context) {
      return;
    }

    await runVerification({
      ...context,
      trigger: 'manual_retry',
    }, {
      afterSuccess: onPairingSuccess,
    });
  }, [onPairingSuccess, runVerification]);

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
            {mode === 'responder' && (
              selectedPeer
                ? `正在与 ${selectedPeer.host_id.slice(0, 8)}... 配对`
                : '自动发现的局域网设备与已知在线设备'
            )}
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
            {status === 'verifying_pending' && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-[#A8A29E]" />
                <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">等待验证上下文</p>
                <p className="text-xs text-[#A8A29E]">正在等待对端 proof request 与 host record 落地</p>
              </div>
            )}
            {status === 'verifying' && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-[#A8A29E]" />
                <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">连接验证中</p>
                <p className="text-xs text-[#A8A29E]">将自动完成双向互通验证</p>
              </div>
            )}
            {status === 'verification_failed' && (
              <div className="flex flex-col items-center gap-2">
                <X className="h-8 w-8 text-red-500" />
                <p className="text-sm text-red-500">{errorMessage}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleRetryVerification();
                    }}
                    className="rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white hover:bg-[#B5502F]"
                  >
                    重试验证
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="rounded-xl border border-[#F0ECE8] px-4 py-2 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
                  >
                    关闭
                  </button>
                </div>
              </div>
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
            {responderPeers.length === 0 && status !== 'loading' && (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-[#78716C]">
                <p>未发现可用于配对的设备</p>
                <p className="text-xs text-[#A8A29E]">请确保对方设备已启动 Runtime 并保持在线</p>
              </div>
            )}
            {responderPeers.map((peer) => (
              <button
                key={peer.host_id}
                type="button"
                className="flex w-full items-center rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#1C1917]"
                onClick={() => handleSelectPeer(peer)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium font-mono text-xs text-[#1C1917] dark:text-[#FAFAF9]">{peer.host_id.slice(0, 12)}...</div>
                    <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                      {peer.sourceLabel}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-[#A8A29E]">
                    {resolveResponderPeerDisplayAddress(peer)}
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
            {status === 'verifying' && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-[#A8A29E]" />
                <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">连接验证中</p>
                <p className="text-xs text-[#A8A29E]">正在验证双方链路与 RTT</p>
              </div>
            )}
            {status === 'verification_failed' && (
              <>
                <X className="h-8 w-8 text-red-500" />
                <p className="text-sm text-red-500">{errorMessage}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleRetryVerification();
                    }}
                    className="rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
                  >
                    重试验证
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
                  >
                    关闭
                  </button>
                </div>
              </>
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
