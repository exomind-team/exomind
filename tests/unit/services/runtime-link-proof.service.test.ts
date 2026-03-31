import { describe, expect, it, vi } from 'vitest';

import {
  RuntimeLinkProofService,
  type RuntimeLinkProofSignalService,
} from '@/lib/services/runtime-link-proof.service';
import type { SignalEvent } from '@/lib/types/signal-pool';

function makeRequestEvent({
  id,
  proofSessionId,
  attemptId,
  initiatedByPeerId,
  targetPeerId,
}: {
  id: string;
  proofSessionId: string;
  attemptId: string;
  initiatedByPeerId: string;
  targetPeerId: string;
}): SignalEvent {
  return {
    schema_version: 1,
    id,
    topic: 'system.link_proof.request',
    ts: 1710000000000,
    source: 'ui:test',
    origin_host_id: initiatedByPeerId,
    hop: 0,
    trace_id: 'trace-link-proof',
    payload: {
      proof_session_id: proofSessionId,
      attempt_id: attemptId,
      initiated_by_peer_id: initiatedByPeerId,
      target_peer_id: targetPeerId,
      trigger: 'pairing_auto',
      sent_at_ms: 1710000000000,
    },
  };
}

function makeAckEvent({
  id,
  proofSessionId,
  attemptId,
  initiatedByPeerId,
  targetPeerId,
  receiptForTargetPeerId,
  ackKind,
  ackedByPeerId,
  completedAtMs,
  observedRttMs,
}: {
  id: string;
  proofSessionId: string;
  attemptId: string;
  initiatedByPeerId: string;
  targetPeerId: string;
  receiptForTargetPeerId?: string;
  ackKind: 'receipt' | 'result';
  ackedByPeerId: string;
  completedAtMs: number;
  observedRttMs?: number;
}): SignalEvent {
  return {
    schema_version: 1,
    id,
    topic: 'system.link_proof.ack',
    ts: completedAtMs,
    source: 'ui:test',
    origin_host_id: ackedByPeerId,
    hop: 1,
    trace_id: 'trace-link-proof',
    payload: {
      proof_session_id: proofSessionId,
      attempt_id: attemptId,
      initiated_by_peer_id: initiatedByPeerId,
      target_peer_id: targetPeerId,
      receipt_for_target_peer_id: receiptForTargetPeerId,
      ack_kind: ackKind,
      acked_by_peer_id: ackedByPeerId,
      observed_rtt_ms: observedRttMs,
      completed_at_ms: completedAtMs,
    },
  };
}

describe('RuntimeLinkProofService（运行时链路验证服务）', () => {
  it('owner mode should publish request, publish result, and wait for peer result（owner 模式应完成本端与对端结果收集）', async () => {
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-local' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-local' });
    const history = vi.fn()
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-receipt-local',
          proofSessionId: 'proof-session-owner',
          attemptId: 'attempt-owner',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000050,
        }),
      ])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-peer-result',
          proofSessionId: 'proof-session-owner',
          attemptId: 'attempt-peer',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000088,
          observedRttMs: 73,
        }),
      ]);
    const hostService = {
      mergeHostMetadata: vi.fn().mockResolvedValue({}),
    };

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      hostService,
      now: () => new Date('2024-03-09T16:00:00.000Z'),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-owner')
        .mockReturnValueOnce('attempt-owner'),
      sleep: vi.fn().mockResolvedValue(undefined),
      timeoutMs: 2000,
      pollIntervalMs: 10,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      runtimeHostRecordId: 'runtime-host-peer',
      trigger: 'pairing_auto',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-owner',
      localInitiatedRttMs: 50,
      peerInitiatedRttMs: 73,
      completedAt: '2024-03-09T16:00:00.088Z',
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, expect.objectContaining({
      topic: 'system.link_proof.request',
      payload: expect.objectContaining({
        proof_session_id: 'proof-session-owner',
        attempt_id: 'attempt-owner',
        initiated_by_peer_id: 'host-desktop',
        target_peer_id: 'host-phone',
        trigger: 'pairing_auto',
      }),
    }));
    expect(publish).toHaveBeenNthCalledWith(2, expect.objectContaining({
      topic: 'system.link_proof.ack',
      payload: expect.objectContaining({
        proof_session_id: 'proof-session-owner',
        attempt_id: 'attempt-owner',
        initiated_by_peer_id: 'host-desktop',
        target_peer_id: 'host-phone',
        ack_kind: 'result',
        acked_by_peer_id: 'host-desktop',
        observed_rtt_ms: 50,
      }),
    }));
    expect(history.mock.calls).toEqual([
      [{ limit: 50, topicPrefix: 'system.link_proof.', afterEventId: 'evt-request-local' }],
      [{ limit: 50, topicPrefix: 'system.link_proof.', afterEventId: 'evt-receipt-local' }],
    ]);
    expect(hostService.mergeHostMetadata).toHaveBeenNthCalledWith(1, 'runtime-host-peer', expect.objectContaining({
      verificationStatus: 'running',
      lastVerificationTrigger: 'pairing_auto',
    }));
    expect(hostService.mergeHostMetadata).toHaveBeenNthCalledWith(2, 'runtime-host-peer', expect.objectContaining({
      verificationStatus: 'verified',
      localInitiatedRttMs: 50,
      peerInitiatedRttMs: 73,
    }));
  });

  it('joiner mode should adopt the incoming proof session id（joiner 模式应采用对端 request 的 session id）', async () => {
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-joiner' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-joiner' });
    const history = vi.fn()
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-receipt-joiner',
          proofSessionId: 'proof-session-shared',
          attemptId: 'attempt-joiner',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000060,
        }),
      ])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-peer-result-shared',
          proofSessionId: 'proof-session-shared',
          attemptId: 'attempt-peer',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000090,
          observedRttMs: 64,
        }),
      ]);

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date('2024-03-09T16:00:00.000Z'),
      createId: vi.fn().mockReturnValue('attempt-joiner'),
      sleep: vi.fn().mockResolvedValue(undefined),
      timeoutMs: 2000,
      pollIntervalMs: 10,
    });

    const result = await service.runVerification({
      mode: 'joiner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'pairing_auto',
      adoptedRequestEvent: makeRequestEvent({
        id: 'evt-peer-request',
        proofSessionId: 'proof-session-shared',
        attemptId: 'attempt-peer',
        initiatedByPeerId: 'host-phone',
        targetPeerId: 'host-desktop',
      }),
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-shared',
      localInitiatedRttMs: 60,
      peerInitiatedRttMs: 64,
      completedAt: '2024-03-09T16:00:00.090Z',
    });
    expect(publish).toHaveBeenNthCalledWith(1, expect.objectContaining({
      payload: expect.objectContaining({
        proof_session_id: 'proof-session-shared',
        attempt_id: 'attempt-joiner',
      }),
    }));
    expect(history.mock.calls).toEqual([
      [{ limit: 50, topicPrefix: 'system.link_proof.', afterEventId: 'evt-peer-request' }],
      [{ limit: 50, topicPrefix: 'system.link_proof.', afterEventId: 'evt-receipt-joiner' }],
    ]);
  });

  it('should perform a final backfill poll before timing out on receipt（回执阶段超时前应执行最后一次补拉）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-late-receipt' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-late-receipt' });
    const history = vi.fn(async () => {
      if (nowMs < 1710000000150) {
        return [];
      }

      return [
        makeAckEvent({
          id: 'evt-receipt-late',
          proofSessionId: 'proof-session-late-receipt',
          attemptId: 'attempt-late-receipt',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000148,
        }),
        makeAckEvent({
          id: 'evt-peer-result-late',
          proofSessionId: 'proof-session-late-receipt',
          attemptId: 'attempt-peer-late',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000149,
          observedRttMs: 71,
        }),
      ];
    });
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-late-receipt')
        .mockReturnValueOnce('attempt-late-receipt'),
      sleep,
      timeoutMs: 150,
      pollIntervalMs: 100,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'manual_retry',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-late-receipt',
      localInitiatedRttMs: 148,
      peerInitiatedRttMs: 71,
      completedAt: '2024-03-09T16:00:00.149Z',
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should perform a final backfill poll before timing out on peer result（对端结果阶段超时前应执行最后一次补拉）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-late-result' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-late-result' });
    const history = vi.fn(async () => {
      if (nowMs === 1710000000000) {
        return [
          makeAckEvent({
            id: 'evt-receipt-early',
            proofSessionId: 'proof-session-late-result',
            attemptId: 'attempt-late-result',
            initiatedByPeerId: 'host-desktop',
            targetPeerId: 'host-desktop',
            receiptForTargetPeerId: 'host-phone',
            ackKind: 'receipt',
            ackedByPeerId: 'host-phone',
            completedAtMs: 1710000000050,
          }),
        ];
      }

      if (nowMs < 1710000000250) {
        return [];
      }

      return [
        makeAckEvent({
          id: 'evt-peer-result-final-backfill',
          proofSessionId: 'proof-session-late-result',
          attemptId: 'attempt-peer-late-result',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000249,
          observedRttMs: 83,
        }),
      ];
    });
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-late-result')
        .mockReturnValueOnce('attempt-late-result'),
      sleep,
      timeoutMs: 260,
      pollIntervalMs: 100,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'manual_retry',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-late-result',
      localInitiatedRttMs: 50,
      peerInitiatedRttMs: 83,
      completedAt: '2024-03-09T16:00:00.249Z',
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should keep waiting for a late receipt after peer result arrives first（先收到对端结果时仍应继续等待迟到的回执）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-peer-result-first' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-peer-result-first' });
    const history = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-peer-result-before-receipt',
          proofSessionId: 'proof-session-peer-result-first',
          attemptId: 'attempt-peer-before-receipt',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000120,
          observedRttMs: 77,
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-receipt-after-peer-result',
          proofSessionId: 'proof-session-peer-result-first',
          attemptId: 'attempt-peer-result-first',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000120,
        }),
      ]);
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-peer-result-first')
        .mockReturnValueOnce('attempt-peer-result-first'),
      sleep,
      timeoutMs: 150,
      pollIntervalMs: 50,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'pairing_auto',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-peer-result-first',
      localInitiatedRttMs: 120,
      peerInitiatedRttMs: 77,
      completedAt: '2024-03-09T16:00:00.120Z',
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should grant peer result a fresh timeout budget after a late receipt（迟到回执后对端结果应获得独立超时预算）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-phase-budget' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-phase-budget' });
    const history = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-receipt-late-phase-budget',
          proofSessionId: 'proof-session-phase-budget',
          attemptId: 'attempt-phase-budget',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000140,
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-peer-result-after-late-receipt',
          proofSessionId: 'proof-session-phase-budget',
          attemptId: 'attempt-peer-phase-budget',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000210,
          observedRttMs: 88,
        }),
      ]);
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-phase-budget')
        .mockReturnValueOnce('attempt-phase-budget'),
      sleep,
      timeoutMs: 150,
      pollIntervalMs: 50,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'manual_retry',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-phase-budget',
      localInitiatedRttMs: 140,
      peerInitiatedRttMs: 88,
      completedAt: '2024-03-09T16:00:00.210Z',
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should fall back to local observation time when receipt clock is skewed behind（回执时钟落后时应退回本地观测时间计算 RTT）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-clock-skew' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-clock-skew' });
    const history = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-receipt-clock-skew',
          proofSessionId: 'proof-session-clock-skew',
          attemptId: 'attempt-clock-skew',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1709999999950,
        }),
        makeAckEvent({
          id: 'evt-peer-result-clock-skew',
          proofSessionId: 'proof-session-clock-skew',
          attemptId: 'attempt-peer-clock-skew',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000000180,
          observedRttMs: 64,
        }),
      ]);
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-clock-skew')
        .mockReturnValueOnce('attempt-clock-skew'),
      sleep,
      timeoutMs: 200,
      pollIntervalMs: 100,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'manual_retry',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-clock-skew',
      localInitiatedRttMs: 100,
      peerInitiatedRttMs: 64,
      completedAt: '2024-03-09T16:00:00.180Z',
    });
    expect(publish).toHaveBeenNthCalledWith(2, expect.objectContaining({
      topic: 'system.link_proof.ack',
      payload: expect.objectContaining({
        observed_rtt_ms: 100,
      }),
    }));
  });

  it('should use a long enough default timeout budget for zero-state validation（默认超时预算应覆盖零状态联调的迟到链路）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn()
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-request-default-budget' })
      .mockResolvedValueOnce({ accepted: true, event_id: 'evt-result-default-budget' });
    const history = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-receipt-default-budget',
          proofSessionId: 'proof-session-default-budget',
          attemptId: 'attempt-default-budget',
          initiatedByPeerId: 'host-desktop',
          targetPeerId: 'host-desktop',
          receiptForTargetPeerId: 'host-phone',
          ackKind: 'receipt',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000006000,
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeAckEvent({
          id: 'evt-peer-result-default-budget',
          proofSessionId: 'proof-session-default-budget',
          attemptId: 'attempt-peer-default-budget',
          initiatedByPeerId: 'host-phone',
          targetPeerId: 'host-desktop',
          ackKind: 'result',
          ackedByPeerId: 'host-phone',
          completedAtMs: 1710000007000,
          observedRttMs: 91,
        }),
      ]);
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-default-budget')
        .mockReturnValueOnce('attempt-default-budget'),
      sleep,
      pollIntervalMs: 1000,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      trigger: 'manual_retry',
    });

    expect(result).toEqual({
      status: 'verified',
      proofSessionId: 'proof-session-default-budget',
      localInitiatedRttMs: 6000,
      peerInitiatedRttMs: 91,
      completedAt: '2024-03-09T16:00:07.000Z',
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should fail with a user-facing timeout when receipt never arrives（回执超时时应返回可展示错误）', async () => {
    let nowMs = 1710000000000;
    const publish = vi.fn().mockResolvedValue({ accepted: true, event_id: 'evt-request-timeout' });
    const history = vi.fn().mockResolvedValue([]);
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });
    const hostService = {
      mergeHostMetadata: vi.fn().mockResolvedValue({}),
    };

    const service = new RuntimeLinkProofService({
      signalService: { publish, history } satisfies RuntimeLinkProofSignalService,
      hostService,
      now: () => new Date(nowMs),
      createId: vi.fn()
        .mockReturnValueOnce('proof-session-timeout')
        .mockReturnValueOnce('attempt-timeout'),
      sleep,
      timeoutMs: 220,
      pollIntervalMs: 100,
    });

    const result = await service.runVerification({
      mode: 'owner',
      localPeerId: 'host-desktop',
      peerId: 'host-phone',
      runtimeHostRecordId: 'runtime-host-peer',
      trigger: 'manual_retry',
    });

    expect(result).toEqual({
      status: 'failed',
      proofSessionId: 'proof-session-timeout',
      phase: 'waiting_receipt',
      errorMessage: '等待链路回执超时',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalled();
    expect(hostService.mergeHostMetadata).toHaveBeenNthCalledWith(1, 'runtime-host-peer', expect.objectContaining({
      verificationStatus: 'running',
      lastVerificationTrigger: 'manual_retry',
    }));
    expect(hostService.mergeHostMetadata).toHaveBeenNthCalledWith(2, 'runtime-host-peer', expect.objectContaining({
      verificationStatus: 'failed',
      lastVerificationTrigger: 'manual_retry',
      lastVerificationError: '等待链路回执超时',
    }));
  });
});
