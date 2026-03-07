import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerPairingDialog } from '@/ui/app/components/PeerPairingDialog';

const initiatePairingMock = vi.hoisted(() => vi.fn());
const listDiscoveredPeersMock = vi.hoisted(() => vi.fn());
const respondToPairingMock = vi.hoisted(() => vi.fn());
const registerPeerLocallyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/runtime-mesh-sync.service', () => ({
  getRuntimeMeshSyncService: () => ({
    initiatePairing: initiatePairingMock,
    listDiscoveredPeers: listDiscoveredPeersMock,
    respondToPairing: respondToPairingMock,
    registerPeerLocally: registerPeerLocallyMock,
  }),
}));

describe('PeerPairingDialog（设备配对弹窗）', () => {
  beforeEach(() => {
    initiatePairingMock.mockReset();
    listDiscoveredPeersMock.mockReset();
    respondToPairingMock.mockReset();
    registerPeerLocallyMock.mockReset();
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
});
