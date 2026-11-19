import { BetaApiError } from './api-error';

export interface BetaOriginalAutoDiagnostics {
  network_enabled: boolean;
  policy_enabled: boolean;
  max_bytes: number;
  active_outbound: number;
  deferred: boolean;
  last_error_code: string | null;
}

export interface BetaOriginalAutoDiagnosticsClient {
  status(): Promise<BetaOriginalAutoDiagnostics>;
}

type NativeCall = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const FIELDS = ['network_enabled', 'policy_enabled', 'max_bytes', 'active_outbound', 'deferred', 'last_error_code'] as const;

function invalid(): never {
  throw new BetaApiError('invalid_original_auto_diagnostics', '本机原件队列诊断尚未确认，请重新检查');
}

function exactObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== FIELDS.length || FIELDS.some(field => !Object.prototype.hasOwnProperty.call(item, field))) {
    return invalid();
  }
  return item;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid();
  return Number(value);
}

function errorCode(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) return invalid();
  return value;
}

export function validateOriginalAutoDiagnostics(value: unknown): BetaOriginalAutoDiagnostics {
  const item = exactObject(value);
  if (typeof item.network_enabled !== 'boolean' || typeof item.policy_enabled !== 'boolean' || typeof item.deferred !== 'boolean') {
    return invalid();
  }
  const maxBytes = nonnegativeInteger(item.max_bytes);
  if (maxBytes === 0) return invalid();
  return {
    network_enabled: item.network_enabled,
    policy_enabled: item.policy_enabled,
    max_bytes: maxBytes,
    active_outbound: nonnegativeInteger(item.active_outbound),
    deferred: item.deferred,
    last_error_code: errorCode(item.last_error_code),
  };
}

const DISPLAYABLE_ERROR_CODES = new Set([
  'cancelled',
  'data_conflict',
  'membership_denied',
  'network_recovery_required',
  'origin_epoch_changed',
  'original_hash_mismatch',
  'original_integrity_mismatch',
  'original_not_ready',
  'original_queue_full',
  'original_source_waiting',
  'original_worker_failed',
  'peer_reset_required',
  'peer_timeout',
  'pin_mismatch',
  'protocol_mismatch',
  'stopped',
  'tls_handshake_failed',
  'unreachable',
]);

/** Only normalized codes produced by the Host peer status paths are safe to show. */
export function visibleOriginalDiagnosticCode(value: unknown): string | null {
  return typeof value === 'string' && DISPLAYABLE_ERROR_CODES.has(value) ? value : null;
}

export function nativeOriginalAutoDiagnostics(call: NativeCall): BetaOriginalAutoDiagnosticsClient {
  return {
    async status() {
      return validateOriginalAutoDiagnostics(await call('beta_peer_original_auto_status'));
    },
  };
}
