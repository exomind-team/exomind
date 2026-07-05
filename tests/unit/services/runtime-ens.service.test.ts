import { describe, expect, it, vi } from 'vitest';
import { RuntimeEnsService } from '@/lib/services/runtime-ens.service';

describe('RuntimeEnsService', () => {
  it('reads ENS snapshot from runtime debug route（读取 ENS 调试快照）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      enabled: true,
      provider_id: 'fake-ens',
      local_identity: {
        identity_hex: 'identity-a',
        host_id: 'rt-a',
      },
      global_topology: 'active',
      health: { status: 'healthy' },
      peers: [],
      interfaces: [{
        name: 'lan-udp',
        type: 'udp',
        online: true,
        outgoing: true,
        interface_address: 'udp://127.0.0.1:4242',
        topology: 'active',
        effective_topology: 'active',
      }],
      operations: [],
      deliveries: [{
        event_id: 'signal-1',
        route_id: 'ens:identity-b',
        peer_identity_hex: 'identity-b',
        status: 'sent',
        started_at: '2026-06-08T00:00:00Z',
        finished_at: '2026-06-08T00:00:00Z',
      }],
      updated_at: '2026-06-08T00:00:00Z',
    })));
    const service = new RuntimeEnsService({ fetchImpl });

    const snapshot = await service.getSnapshot('http://127.0.0.1:9124', 'admin-token');

    expect(snapshot.provider_id).toBe('fake-ens');
    expect(snapshot.local_identity?.identity_hex).toBe('identity-a');
    expect(snapshot.interfaces[0]?.interface_address).toBe('udp://127.0.0.1:4242');
    expect(snapshot.deliveries[0]?.status).toBe('sent');
    expect(snapshot.deliveries[0]?.peer_identity_hex).toBe('identity-b');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9124/mesh/ens/snapshot',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer admin-token');
  });

  it('sets one interface topology through typed route（设置单接口 topology）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: 'lan-udp',
      type: 'udp',
      online: true,
      outgoing: true,
      interface_address: 'udp://127.0.0.1:4242',
      topology: 'passive',
      effective_topology: 'passive',
    })));
    const service = new RuntimeEnsService({ fetchImpl });

    const updated = await service.setInterfaceTopology(
      'http://127.0.0.1:9124',
      'lan-udp',
      'passive',
    );

    expect(updated.topology).toBe('passive');
    expect(updated.effective_topology).toBe('passive');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9124/mesh/ens/interfaces/lan-udp/topology',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ topology: 'passive' }),
      }),
    );
  });

  it('sets global topology through snapshot truth route（设置全局 topology 并返回后端快照）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      enabled: true,
      provider_id: 'fake-ens',
      local_identity: {
        identity_hex: 'identity-a',
        host_id: 'rt-a',
      },
      global_topology: 'passive',
      health: { status: 'healthy' },
      peers: [],
      interfaces: [{
        name: 'lan-udp',
        type: 'udp',
        online: true,
        outgoing: true,
        interface_address: 'udp://127.0.0.1:4242',
        topology: 'active',
        effective_topology: 'passive',
      }],
      operations: [],
      deliveries: [],
      updated_at: '2026-06-08T00:00:00Z',
    })));
    const service = new RuntimeEnsService({ fetchImpl });

    const updated = await service.setGlobalTopology(
      'http://127.0.0.1:9124',
      'passive',
      'admin-token',
    );

    expect(updated.global_topology).toBe('passive');
    expect(updated.local_identity?.identity_hex).toBe('identity-a');
    expect(updated.interfaces[0]?.interface_address).toBe('udp://127.0.0.1:4242');
    expect(updated.interfaces[0]?.topology).toBe('active');
    expect(updated.interfaces[0]?.effective_topology).toBe('passive');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9124/mesh/ens/topology',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ topology: 'passive' }),
      }),
    );
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer admin-token');
  });

  it('starts pairing from discovered ENS peer（从发现节点发起配对）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      operation_id: 'op-1',
      session_id: 'session-1',
      pin: '123456',
      status: 'pending',
    })));
    const service = new RuntimeEnsService({ fetchImpl });

    const ticket = await service.initiatePairingWithDiscoveredPeer(
      'http://127.0.0.1:9124',
      'identity-b',
    );

    expect(ticket.pin).toBe('123456');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9124/mesh/ens/pairing/discovered/identity-b',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
