/** Explicit allowlist schema for the only diagnostic fields that may leave a
 * failure surface. Secret/body/content/token/original bytes are never copied. */
export interface RedactedDiagnostic {
  operation: string | null;
  code: string | null;
  deviceId: string | null;
  profileId: string | null;
  candidate: string | null;
  lastStage: string | null;
  timestampMs: number | null;
}

const MASK_PREFIX_LENGTH = 8;
const MAX_JAVASCRIPT_DATE_MS = 8_640_000_000_000_000;

/** Stable-prefix mask: keeps a deterministic head of an identifier and drops
 * everything after it. Short identifiers are returned unchanged. */
export function maskStableId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, MASK_PREFIX_LENGTH);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asTimestamp(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_JAVASCRIPT_DATE_MS
    ? value
    : null;
}

function isRecord(source: unknown): source is Record<string, unknown> {
  return typeof source === 'object'
    && source !== null
    && !Array.isArray(source)
    && !(source instanceof Error);
}

/** Project an arbitrary failure payload onto the allowlist. Arrays, errors,
 * primitives and other non-records collapse to a safe empty diagnostic; no
 * exception message or stack is ever read or serialized. */
export function redactDiagnostic(source: unknown): RedactedDiagnostic {
  if (!isRecord(source)) {
    return {
      operation: null,
      code: null,
      deviceId: null,
      profileId: null,
      candidate: null,
      lastStage: null,
      timestampMs: null,
    };
  }

  return {
    operation: asString(source.operation),
    code: asString(source.code),
    deviceId: maskStableId(source.deviceId),
    profileId: maskStableId(source.profileId),
    candidate: asString(source.candidate),
    lastStage: asString(source.lastStage),
    timestampMs: asTimestamp(source.timestampMs),
  };
}
