import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerPairingDialog } from '@/ui/app/components/PeerPairingDialog';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';

const initiatePairingMock = vi.hoisted(() => vi.fn());
const listDiscoveredPeersMock = vi.hoisted(() => vi.fn());
const listMeshPeersMock = vi.hoisted(() => vi.fn());
const respondToPairingMock = vi.hoisted(() => vi.fn());
const registerPeerLocallyMock = vi.hoisted(() => vi.fn());
const getPeerDialAddressMock = vi.hoisted(() => vi.fn());
const listHostsMock = vi.hoisted(() => vi.fn());
const signalHistoryMock = vi.hoisted(() => vi.fn());
const runVerificationMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/runtime-mesh-sync.service', () => ({
  getRuntimeMeshSyncService: () => ({
    initiatePairing: initiatePairingMock,
    listDiscoveredPeers: listDiscoveredPeersMock,
    listMeshPeers: listMeshPeersMock,
    respondToPairing: respondToPairingMock,
    registerPeerLocally: registerPeerLocallyMock,
  }),
}));

vi.mock('@/lib/services/runtime-host.service', () => ({
  getRuntimeHostService: () => ({
    listHosts: listHostsMock,
  }),
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: class MockSignalStreamService {
    async history(query?: unknown) {
      return signalHistoryMock(query);
    }
  },
}));

vi.mock('@/lib/services/runtime-link-proof.service', () => ({
  createRuntimeLinkProofService: () => ({
    runVerification: runVerificationMock,
  }),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => ({
    getReachableAddress: vi.fn(async () => ({
      host: '10.0.2.2',
      port: 9124,
      hostId: 'desktop-host',
    })),
    getPeerDialAddress: getPeerDialAddressMock,
  }),
}));

describe('PeerPairingDialog（设备配对弹窗）', () => {
  beforeEach(() => {
    initiatePairingMock.mockReset();
    listDiscoveredPeersMock.mockReset();
    listMeshPeersMock.mockReset();
    respondToPairingMock.mockReset();
    registerPeerLocallyMock.mockReset();
    getPeerDialAddressMock.mockReset();
    listHostsMock.mockReset();
    signalHistoryMock.mockReset();
    runVerificationMock.mockReset();
    getPeerDialAddressMock.mockResolvedValue({
      host: '127.0.0.1',
      port: 39124,
    });
  });

  it('shows initiator diagnostics in UI when pairing start fails（发起配对失败时在界面显示诊断信息）', async () => {
    initiatePairingMock.mockRejectedValue(
      new Error('initiatePairing failed: POST http://127.0.0.1:4077/mesh/pairing/initiate -> HTTP 401 Unauthorized, auth=missing, body=missing bearer token'),
    );

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="mobile-host"
        localAuthToken={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发起配对 生成 PIN 码，等待其他设备输入' }));

    await waitFor(() => {
      expect(screen.getByText(/发起配对失败/)).toBeInTheDocument();
    });
    expect(screen.getByText(/runtime=http:\/\/127\.0\.0\.1:4077/)).toBeInTheDocument();
    expect(screen.getByText(/hostId=mobile-host/)).toBeInTheDocument();
    expect(screen.getByText(/auth=missing/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 401 Unauthorized/)).toBeInTheDocument();
  });

  it('passes local auth token on responder refresh（响应配对刷新时传递本地鉴权 token）', async () => {
    listDiscoveredPeersMock.mockResolvedValue([]);

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="desktop-host"
        localAuthToken="embedded-secret"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '响应配对 扫描局域网设备，输入对方的 PIN 码' }));

    await waitFor(() => {
      expect(listDiscoveredPeersMock).toHaveBeenCalledWith(
        'http://127.0.0.1:4077',
        'embedded-secret',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(listDiscoveredPeersMock).toHaveBeenNthCalledWith(
        2,
        'http://127.0.0.1:4077',
        'embedded-secret',
      );
    });
  });

  it('shows known confirmed peers when mDNS discovery is empty（mDNS 为空时仍展示已连接设备）', async () => {
    listDiscoveredPeersMock.mockResolvedValue([]);
    const knownHost: RuntimeHostRecord = {
      id: 'runtime-host-android',
      name: 'Android Phone',
      host: '10.0.2.15',
      port: 9124,
      status: 'online',
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
      hostId: 'android-host-id',
      trustState: 'confirmed_peer',
      manualOverride: '127.0.0.1:39124',
      lastSuccessfulDialAddress: '127.0.0.1:39124',
    };

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="desktop-host"
        localAuthToken="embedded-secret"
        knownHosts={[knownHost]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '响应配对 扫描局域网设备，输入对方的 PIN 码' }));

    await waitFor(() => {
      expect(screen.getByText(/127\.0\.0\.1:39124/)).toBeInTheDocument();
      expect(screen.getByText('已连接')).toBeInTheDocument();
    });
    expect(screen.queryByText('未发现局域网设备')).not.toBeInTheDocument();
  });

  it('enters pin input mode after selecting a discovered peer（选择已发现设备后进入 PIN 输入态）', async () => {
    listDiscoveredPeersMock.mockResolvedValue([
      {
        host_id: 'desktop-host-id',
        host: '192.168.1.20',
        port: 9124,
      },
    ]);

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="mobile-host"
        localAuthToken="embedded-secret"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '响应配对 扫描局域网设备，输入对方的 PIN 码' }));

    const peerAddress = await screen.findByText(/192\.168\.1\.20/);
    const peerButton = peerAddress.closest('button');
    expect(peerButton).not.toBeNull();
    fireEvent.click(peerButton!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认配对' })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('uses resolved peer dial address when submitting responder pin（响应配对提交时使用解析后的拨号地址）', async () => {
    listDiscoveredPeersMock.mockResolvedValue([
      {
        host_id: 'android-host-id',
        host: '10.0.2.15',
        port: 9124,
      },
    ]);
    respondToPairingMock.mockResolvedValue({
      paired: true,
      peer_token: 'peer-token-1',
      initiator_inbound_token: 'initiator-inbound-1',
    });
    registerPeerLocallyMock.mockResolvedValue(undefined);

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="desktop-host"
        localAuthToken="embedded-secret"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '响应配对 扫描局域网设备，输入对方的 PIN 码' }));

    const peerAddress = await screen.findByText(/10\.0\.2\.15/);
    fireEvent.click(peerAddress.closest('button')!);

    const inputs = await screen.findAllByRole('textbox');
    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(inputs[index]!, { target: { value: digit } });
    });
    fireEvent.click(screen.getByRole('button', { name: '确认配对' }));

    await waitFor(() => {
      expect(getPeerDialAddressMock).toHaveBeenCalledWith('10.0.2.15', 9124);
      expect(respondToPairingMock).toHaveBeenCalledWith(
        'http://127.0.0.1:39124',
        '',
        '123456',
        'desktop-host',
        'http://10.0.2.2:9124',
        expect.any(String),
      );
      expect(registerPeerLocallyMock).toHaveBeenCalledWith(
        'http://127.0.0.1:4077',
        'android-host-id',
        'http://127.0.0.1:39124',
        'initiator-inbound-1',
        expect.any(String),
        'embedded-secret',
      );
    });
  });

  it('transitions initiator from waiting to verifying pending then verifying（发起方应先等待验证上下文再进入验证）', async () => {
    initiatePairingMock.mockResolvedValue({
      session_id: 'pairing-session-1',
      pin: '123456',
    });
    listMeshPeersMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'phone-peer-id',
          base_url: 'http://10.0.2.15:9124',
          enabled: true,
        },
      ]);
    listHostsMock.mockResolvedValue([
      {
        id: 'runtime-host-phone',
        name: 'Phone Peer',
        host: '10.0.2.15',
        port: 9124,
        status: 'online',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        hostId: 'phone-peer-id',
        trustState: 'confirmed_peer',
      } satisfies RuntimeHostRecord,
    ]);
    const proofEventTs = Date.now() + 1000;
    signalHistoryMock.mockResolvedValue([
      {
        id: 'evt-proof-request',
        schema_version: 1,
        topic: 'system.link_proof.request',
        ts: proofEventTs,
        source: 'ui:test',
        origin_host_id: 'phone-peer-id',
        hop: 0,
        trace_id: 'trace-proof',
        payload: {
          proof_session_id: 'proof-session-join',
          attempt_id: 'attempt-peer',
          initiated_by_peer_id: 'phone-peer-id',
          target_peer_id: 'desktop-host',
          trigger: 'pairing_auto',
          sent_at_ms: proofEventTs,
        },
      },
    ]);
    let resolveVerification: ((value: unknown) => void) | null = null;
    runVerificationMock.mockReturnValue(new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    const onPairingSuccess = vi.fn().mockResolvedValue(undefined);

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="desktop-host"
        localAuthToken="embedded-secret"
        onPairingSuccess={onPairingSuccess}
        timingOverrides={{
          initiatorPeerPollIntervalMs: 1,
          adoptionPollIntervalMs: 1,
          adoptionWindowMs: 20,
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发起配对 生成 PIN 码，等待其他设备输入' }));
    });

    expect(screen.getByText('等待对方输入 PIN')).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.queryByText('等待验证上下文') ?? screen.queryByText('连接验证中'),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(runVerificationMock).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'joiner',
        localPeerId: 'desktop-host',
        peerId: 'phone-peer-id',
        runtimeHostRecordId: 'runtime-host-phone',
      }));
    });

    resolveVerification?.({
      status: 'verified',
      proofSessionId: 'proof-session-join',
      localInitiatedRttMs: 41,
      peerInitiatedRttMs: 55,
      completedAt: '2026-03-30T10:00:00.000Z',
    });

    await waitFor(() => {
      expect(screen.getByText('配对成功')).toBeInTheDocument();
    });
  });

  it('runs responder verification after pin pairing succeeds（响应方在 PIN 成功后进入连接验证）', async () => {
    listDiscoveredPeersMock.mockResolvedValue([
      {
        host_id: 'android-host-id',
        host: '10.0.2.15',
        port: 9124,
      },
    ]);
    respondToPairingMock.mockResolvedValue({
      paired: true,
      peer_token: 'peer-token-1',
      initiator_inbound_token: 'initiator-inbound-1',
    });
    registerPeerLocallyMock.mockResolvedValue(undefined);
    listHostsMock.mockResolvedValue([
      {
        id: 'runtime-host-android',
        name: 'Android Phone',
        host: '10.0.2.15',
        port: 9124,
        status: 'online',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        hostId: 'android-host-id',
        trustState: 'confirmed_peer',
      } satisfies RuntimeHostRecord,
    ]);
    let resolveVerification: ((value: unknown) => void) | null = null;
    runVerificationMock.mockReturnValue(new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    const onPairingSuccess = vi.fn().mockResolvedValue(undefined);

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="desktop-host"
        localAuthToken="embedded-secret"
        onPairingSuccess={onPairingSuccess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '响应配对 扫描局域网设备，输入对方的 PIN 码' }));
    const peerAddress = await screen.findByText(/10\.0\.2\.15/);
    fireEvent.click(peerAddress.closest('button')!);

    const inputs = await screen.findAllByRole('textbox');
    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(inputs[index]!, { target: { value: digit } });
    });
    fireEvent.click(screen.getByRole('button', { name: '确认配对' }));

    await waitFor(() => {
      expect(screen.getByText('连接验证中')).toBeInTheDocument();
    });
    expect(runVerificationMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'owner',
      localPeerId: 'desktop-host',
      peerId: 'android-host-id',
      runtimeHostRecordId: 'runtime-host-android',
      trigger: 'pairing_auto',
    }));

    resolveVerification?.({
      status: 'verified',
      proofSessionId: 'proof-session-owner',
      localInitiatedRttMs: 42,
      peerInitiatedRttMs: 57,
      completedAt: '2026-03-30T10:00:00.000Z',
    });

    await waitFor(() => {
      expect(screen.getByText('配对成功')).toBeInTheDocument();
    });
  });

  it('allows retrying verification without re-entering pin（验证失败后可直接重试，不必重新输入 PIN）', async () => {
    listDiscoveredPeersMock.mockResolvedValue([
      {
        host_id: 'android-host-id',
        host: '10.0.2.15',
        port: 9124,
      },
    ]);
    respondToPairingMock.mockResolvedValue({
      paired: true,
      peer_token: 'peer-token-1',
      initiator_inbound_token: 'initiator-inbound-1',
    });
    registerPeerLocallyMock.mockResolvedValue(undefined);
    listHostsMock.mockResolvedValue([
      {
        id: 'runtime-host-android',
        name: 'Android Phone',
        host: '10.0.2.15',
        port: 9124,
        status: 'online',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:00:00.000Z',
        hostId: 'android-host-id',
        trustState: 'confirmed_peer',
      } satisfies RuntimeHostRecord,
    ]);
    runVerificationMock
      .mockResolvedValueOnce({
        status: 'failed',
        phase: 'waiting_peer_result',
        proofSessionId: 'proof-session-owner',
        errorMessage: '等待对端验证结果超时',
      })
      .mockResolvedValueOnce({
        status: 'verified',
        proofSessionId: 'proof-session-retry',
        localInitiatedRttMs: 39,
        peerInitiatedRttMs: 44,
        completedAt: '2026-03-30T10:00:05.000Z',
      });

    render(
      <PeerPairingDialog
        open
        onOpenChange={() => {}}
        runtimeBaseUrl="http://127.0.0.1:4077"
        localHostId="desktop-host"
        localAuthToken="embedded-secret"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '响应配对 扫描局域网设备，输入对方的 PIN 码' }));
    const peerAddress = await screen.findByText(/10\.0\.2\.15/);
    fireEvent.click(peerAddress.closest('button')!);

    const inputs = await screen.findAllByRole('textbox');
    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(inputs[index]!, { target: { value: digit } });
    });
    fireEvent.click(screen.getByRole('button', { name: '确认配对' }));

    await waitFor(() => {
      expect(screen.getByText('等待对端验证结果超时')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '重试验证' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认配对' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试验证' }));

    await waitFor(() => {
      expect(runVerificationMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText('配对成功')).toBeInTheDocument();
    });
  });
});
