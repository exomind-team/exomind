import type { RuntimeHostVerificationTrigger } from '@/lib/types/agent-hub';
import type { RuntimeHostMetadataPatch, RuntimeHostService } from './runtime-host.service';
import type {
  SignalEvent,
  PublishResponse,
  LinkProofAckPayload,
  LinkProofRequestPayload,
} from '@/lib/types/signal-pool';

const LINK_PROOF_REQUEST_TOPIC = 'system.link_proof.request';
const LINK_PROOF_ACK_TOPIC = 'system.link_proof.ack';
const LINK_PROOF_TOPIC_PREFIX = 'system.link_proof.';
const DEFAULT_HISTORY_LIMIT = 50;
// Zero-state desktop + Android pairing can take multiple routed proof hops before both receipts land.
// 默认给足 10s，避免首轮配对 / 手动复测在 emulator 时序下过早超时。
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export interface RuntimeLinkProofSignalService {
  publish(request: {
    topic: string;
    source?: string;
    payload: unknown;
    trace_id?: string;
    origin_host_id?: string;
  }): Promise<PublishResponse>;
  history(query?: {
    limit?: number;
    topicPrefix?: string;
    afterEventId?: string;
    excludeTopicPrefix?: string;
  }): Promise<SignalEvent[]>;
}

export interface RuntimeLinkProofServiceOptions {
  signalService: RuntimeLinkProofSignalService;
  hostService?: Pick<RuntimeHostService, 'mergeHostMetadata'>;
  now?: () => Date;
  createId?: () => string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface RuntimeLinkProofRunOptions {
  mode: 'owner' | 'joiner';
  localPeerId: string;
  peerId: string;
  runtimeHostRecordId?: string;
  trigger: RuntimeHostVerificationTrigger;
  adoptedRequestEvent?: SignalEvent;
}

export interface RuntimeLinkProofVerifiedResult {
  status: 'verified';
  proofSessionId: string;
  localInitiatedRttMs: number;
  peerInitiatedRttMs: number;
  completedAt: string;
}

export interface RuntimeLinkProofFailedResult {
  status: 'failed';
  proofSessionId?: string;
  phase: 'setup' | 'waiting_receipt' | 'waiting_peer_result';
  errorMessage: string;
}

export type RuntimeLinkProofResult =
  | RuntimeLinkProofVerifiedResult
  | RuntimeLinkProofFailedResult;

export class RuntimeLinkProofService {
  constructor(private readonly options: RuntimeLinkProofServiceOptions) {}

  async runVerification(input: RuntimeLinkProofRunOptions): Promise<RuntimeLinkProofResult> {
    const proofSessionId = this.resolveProofSessionId(input);
    if (!proofSessionId) {
      return this.failVerification(input, undefined, 'setup', '接入链路验证会话失败');
    }

    if (!input.localPeerId || !input.peerId) {
      return this.failVerification(input, proofSessionId, 'setup', '链路验证缺少 peer 标识');
    }

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const attemptId = this.createId();
    const sentAtMs = this.now().getTime();

    await this.persistVerificationPatch(input.runtimeHostRecordId, {
      verificationStatus: 'running',
      lastVerificationTrigger: input.trigger,
      lastVerificationError: null,
      localInitiatedRttMs: null,
      peerInitiatedRttMs: null,
    });

    const requestPayload: LinkProofRequestPayload = {
      proof_session_id: proofSessionId,
      attempt_id: attemptId,
      initiated_by_peer_id: input.localPeerId,
      target_peer_id: input.peerId,
      trigger: input.trigger,
      sent_at_ms: sentAtMs,
    };

    const requestPublish = await this.options.signalService.publish({
      topic: LINK_PROOF_REQUEST_TOPIC,
      source: 'ui:runtime_link_proof',
      origin_host_id: input.localPeerId,
      payload: requestPayload,
    });

    let cursor = input.mode === 'joiner'
      ? input.adoptedRequestEvent?.id ?? requestPublish.event_id
      : requestPublish.event_id;
    let peerResult = this.capturePeerResultFromAdoptedEvent(input, proofSessionId);
    let receiptAck: LinkProofAckPayload | null = null;
    let receiptObservedAtMs: number | null = null;
    let receiptDeadlineMs = sentAtMs + timeoutMs;
    if (peerResult) {
      receiptDeadlineMs = Math.max(receiptDeadlineMs, this.now().getTime() + timeoutMs);
    }

    while (true) {
      const pollResult = await this.pollProofEvents(cursor, proofSessionId);
      cursor = pollResult.cursor ?? cursor;

      for (const ack of pollResult.acks) {
        if (this.isReceiptAckForLocalAttempt(input, attemptId, ack)) {
          receiptAck = ack;
          receiptObservedAtMs = this.now().getTime();
        }
        if (this.isPeerResultAck(input, ack)) {
          if (!peerResult && !receiptAck) {
            receiptDeadlineMs = Math.max(receiptDeadlineMs, this.now().getTime() + timeoutMs);
          }
          peerResult = ack;
        }
      }

      if (receiptAck) {
        break;
      }

      const remainingMs = receiptDeadlineMs - this.now().getTime();
      if (remainingMs <= 0) {
        break;
      }

      await this.sleep(Math.min(pollIntervalMs, remainingMs));
    }

    if (!receiptAck) {
      return this.failVerification(input, proofSessionId, 'waiting_receipt', '等待链路回执超时');
    }

    const localInitiatedObservedAtMs = receiptAck.completed_at_ms >= sentAtMs
      ? receiptAck.completed_at_ms
      : receiptObservedAtMs ?? this.now().getTime();
    const localInitiatedRttMs = Math.max(0, localInitiatedObservedAtMs - sentAtMs);

    await this.options.signalService.publish({
      topic: LINK_PROOF_ACK_TOPIC,
      source: 'ui:runtime_link_proof',
      origin_host_id: input.localPeerId,
      payload: {
        proof_session_id: proofSessionId,
        attempt_id: attemptId,
        initiated_by_peer_id: input.localPeerId,
        target_peer_id: input.peerId,
        ack_kind: 'result',
        acked_by_peer_id: input.localPeerId,
        observed_rtt_ms: localInitiatedRttMs,
        completed_at_ms: this.now().getTime(),
      } satisfies LinkProofAckPayload,
    });

    const peerResultDeadlineMs = this.now().getTime() + timeoutMs;
    while (!peerResult) {
      const pollResult = await this.pollProofEvents(cursor, proofSessionId);
      cursor = pollResult.cursor ?? cursor;

      for (const ack of pollResult.acks) {
        if (this.isPeerResultAck(input, ack)) {
          peerResult = ack;
          break;
        }
      }

      if (peerResult) {
        break;
      }

      const remainingMs = peerResultDeadlineMs - this.now().getTime();
      if (remainingMs <= 0) {
        break;
      }

      await this.sleep(Math.min(pollIntervalMs, remainingMs));
    }

    if (!peerResult || typeof peerResult.observed_rtt_ms !== 'number') {
      return this.failVerification(
        input,
        proofSessionId,
        'waiting_peer_result',
        '等待对端验证结果超时',
      );
    }

    const completedAt = new Date(peerResult.completed_at_ms).toISOString();

    await this.persistVerificationPatch(input.runtimeHostRecordId, {
      verificationStatus: 'verified',
      lastVerificationTrigger: input.trigger,
      lastVerifiedAt: completedAt,
      lastVerificationError: null,
      localInitiatedRttMs,
      peerInitiatedRttMs: peerResult.observed_rtt_ms,
    });

    return {
      status: 'verified',
      proofSessionId,
      localInitiatedRttMs,
      peerInitiatedRttMs: peerResult.observed_rtt_ms,
      completedAt,
    };
  }

  protected async persistVerificationPatch(
    runtimeHostRecordId: string | undefined,
    patch: RuntimeHostMetadataPatch,
  ): Promise<void> {
    if (!runtimeHostRecordId || !this.options.hostService) {
      return;
    }
    await this.options.hostService.mergeHostMetadata(runtimeHostRecordId, patch);
  }

  private resolveProofSessionId(input: RuntimeLinkProofRunOptions): string | undefined {
    if (input.mode === 'owner') {
      return this.createId();
    }

    const adoptedRequestPayload = input.adoptedRequestEvent
      ? this.parseRequestPayload(input.adoptedRequestEvent)
      : null;
    return adoptedRequestPayload?.proof_session_id;
  }

  private capturePeerResultFromAdoptedEvent(
    input: RuntimeLinkProofRunOptions,
    proofSessionId: string,
  ): LinkProofAckPayload | null {
    if (!input.adoptedRequestEvent || input.adoptedRequestEvent.topic !== LINK_PROOF_ACK_TOPIC) {
      return null;
    }

    const ack = this.parseAckPayload(input.adoptedRequestEvent);
    if (!ack || ack.proof_session_id !== proofSessionId) {
      return null;
    }

    return this.isPeerResultAck(input, ack) ? ack : null;
  }

  private async pollProofEvents(
    afterEventId: string | undefined,
    proofSessionId: string,
  ): Promise<{ cursor?: string; acks: LinkProofAckPayload[] }> {
    const events = await this.options.signalService.history({
      limit: DEFAULT_HISTORY_LIMIT,
      topicPrefix: LINK_PROOF_TOPIC_PREFIX,
      afterEventId,
    });
    const cursor = events.length > 0 ? events[events.length - 1]?.id : undefined;
    const acks = events
      .filter((event) => event.topic === LINK_PROOF_ACK_TOPIC)
      .map((event) => this.parseAckPayload(event))
      .filter((ack): ack is LinkProofAckPayload => Boolean(ack))
      .filter((ack) => ack.proof_session_id === proofSessionId);

    return { cursor, acks };
  }

  private isPeerResultAck(
    input: RuntimeLinkProofRunOptions,
    ack: LinkProofAckPayload,
  ): boolean {
    return ack.ack_kind === 'result'
      && ack.initiated_by_peer_id === input.peerId
      && ack.target_peer_id === input.localPeerId
      && ack.acked_by_peer_id === input.peerId;
  }

  private isReceiptAckForLocalAttempt(
    input: RuntimeLinkProofRunOptions,
    attemptId: string,
    ack: LinkProofAckPayload,
  ): boolean {
    return ack.ack_kind === 'receipt'
      && ack.attempt_id === attemptId
      && ack.initiated_by_peer_id === input.localPeerId
      // receipt ack is routed back to the initiator, so target_peer_id points to local peer
      && ack.target_peer_id === input.localPeerId
      && ack.acked_by_peer_id === input.peerId
      && (
        typeof ack.receipt_for_target_peer_id !== 'string'
        || ack.receipt_for_target_peer_id === input.peerId
      );
  }

  private async failVerification(
    input: RuntimeLinkProofRunOptions,
    proofSessionId: string | undefined,
    phase: RuntimeLinkProofFailedResult['phase'],
    errorMessage: string,
  ): Promise<RuntimeLinkProofFailedResult> {
    await this.persistVerificationPatch(input.runtimeHostRecordId, {
      verificationStatus: 'failed',
      lastVerificationTrigger: input.trigger,
      lastVerificationError: errorMessage,
      localInitiatedRttMs: null,
      peerInitiatedRttMs: null,
    });

    return {
      status: 'failed',
      proofSessionId,
      phase,
      errorMessage,
    };
  }

  private parseRequestPayload(event: SignalEvent): LinkProofRequestPayload | null {
    const payload = this.asRecord(event.payload);
    if (!payload) {
      return null;
    }

    const proofSessionId = this.readString(payload, 'proof_session_id');
    const attemptId = this.readString(payload, 'attempt_id');
    const initiatedByPeerId = this.readString(payload, 'initiated_by_peer_id');
    const targetPeerId = this.readString(payload, 'target_peer_id');
    const trigger = this.readString(payload, 'trigger');
    const sentAtMs = this.readNumber(payload, 'sent_at_ms');

    if (
      !proofSessionId
      || !attemptId
      || !initiatedByPeerId
      || !targetPeerId
      || !trigger
      || typeof sentAtMs !== 'number'
    ) {
      return null;
    }

    return {
      proof_session_id: proofSessionId,
      attempt_id: attemptId,
      initiated_by_peer_id: initiatedByPeerId,
      target_peer_id: targetPeerId,
      trigger: trigger as LinkProofRequestPayload['trigger'],
      sent_at_ms: sentAtMs,
    };
  }

  private parseAckPayload(event: SignalEvent): LinkProofAckPayload | null {
    const payload = this.asRecord(event.payload);
    if (!payload) {
      return null;
    }

    const proofSessionId = this.readString(payload, 'proof_session_id');
    const attemptId = this.readString(payload, 'attempt_id');
    const initiatedByPeerId = this.readString(payload, 'initiated_by_peer_id');
    const targetPeerId = this.readString(payload, 'target_peer_id');
    const receiptForTargetPeerId = this.readString(payload, 'receipt_for_target_peer_id');
    const ackKind = this.readString(payload, 'ack_kind');
    const ackedByPeerId = this.readString(payload, 'acked_by_peer_id');
    const completedAtMs = this.readNumber(payload, 'completed_at_ms');
    const observedRttMs = this.readNumber(payload, 'observed_rtt_ms');

    if (
      !proofSessionId
      || !attemptId
      || !initiatedByPeerId
      || !targetPeerId
      || !ackKind
      || !ackedByPeerId
      || typeof completedAtMs !== 'number'
    ) {
      return null;
    }

    return {
      proof_session_id: proofSessionId,
      attempt_id: attemptId,
      initiated_by_peer_id: initiatedByPeerId,
      target_peer_id: targetPeerId,
      receipt_for_target_peer_id: receiptForTargetPeerId,
      ack_kind: ackKind as LinkProofAckPayload['ack_kind'],
      acked_by_peer_id: ackedByPeerId,
      observed_rtt_ms: observedRttMs,
      completed_at_ms: completedAtMs,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readNumber(payload: Record<string, unknown>, key: string): number | undefined {
    const value = payload[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private createId(): string {
    return this.options.createId?.() ?? crypto.randomUUID();
  }

  private async sleep(ms: number): Promise<void> {
    if (this.options.sleep) {
      await this.options.sleep(ms);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createRuntimeLinkProofService(
  options: RuntimeLinkProofServiceOptions,
): RuntimeLinkProofService {
  return new RuntimeLinkProofService(options);
}
