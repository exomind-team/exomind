import { invoke, isTauri } from "@tauri-apps/api/core";

export const ORIGINAL_LIFECYCLE_COMMANDS = {
  capabilities: "beta_original_lifecycle_capabilities",
  status: "beta_original_lifecycle_status",
  apply: "beta_apply_original_lifecycle",
  retryCacheCleanup: "beta_retry_original_cache_cleanup",
  revealCache: "beta_reveal_original_cache",
  retryRestore: "beta_retry_original_restore",
  followups: "beta_original_lifecycle_followups",
} as const;

export const ORIGINAL_LIFECYCLE_SCHEMA_VERSION = 1;
export const ORIGINAL_LIFECYCLE_CORE_SCHEMA = 10;
const SUPPORTED_LIFECYCLE_CORE_SCHEMAS = [ORIGINAL_LIFECYCLE_CORE_SCHEMA, 11] as const;

export type OriginalLifecycleAction =
  | "reclaim"
  | "restore"
  | "release_local"
  | "purge_reclaimed";
export type OriginalBytesState =
  | "available"
  | "reclaimed"
  | "released"
  | "purged"
  | "restore_pending"
  | "missing";
export type OriginalCachePresence = "present" | "absent" | "unknown";
export type OriginalCachePolicy = "verified_same_handle" | "retained";
export type OriginalCacheCleanupStatus =
  | "complete"
  | "partial"
  | "recovery_required"
  | "not_applicable";
export type OriginalCacheCleanupReason =
  | "filesystem_rejected"
  | "modified"
  | "unsupported"
  | "unsafe_path"
  | "unavailable"
  | "verification_incomplete";

export interface OriginalLifecycleCapabilities {
  schema_version: 1;
  core_schema: 10 | 11;
  operations: OriginalLifecycleAction[];
  cache_policy: OriginalCachePolicy;
  supports_reveal: boolean;
  supports_restore_retry?: boolean;
  supports_followups?: boolean;
}

export interface OriginalLifecycleCommand {
  command_id: string;
  event_id: string;
  profile_id: string;
  original_id: string;
  expected_generation: number;
  occurred_at_ms: number;
  action: OriginalLifecycleAction;
  cleanup_confirmed: boolean;
  follow_up_device_ids: string[];
  responds_to_event_id: string | null;
}

export interface OriginalLifecycleReceipt {
  command_id: string;
  event_id: string;
  profile_id: string;
  local_seq: number;
  event_digest: string;
  durability: "local_committed";
  replayed: boolean;
}

export interface OriginalLifecycleLocalStatus {
  profile_id: string;
  original: { original_id: string };
  bytes_state: OriginalBytesState;
  generation: number;
  latest_event_id: string | null;
  restore_request_event_id: string | null;
  restore_completion_event_id: string | null;
  reclaimed_at_ms: number | null;
  recovery_window_ms: number | null;
  reclaim_deadline_ms: number | null;
}

export interface OriginalLifecycleHostStatus {
  local: OriginalLifecycleLocalStatus;
  remote_sources: Array<{ device_id: string; state: string }>;
}

export interface OriginalLifecycleStatus {
  lifecycle: OriginalLifecycleHostStatus;
  cache_presence: OriginalCachePresence;
}

export interface OriginalLifecycleFollowupRequest {
  event_id: string;
  profile_id: string;
  device_id: string;
  author_id: string;
  original_id: string;
  action: "release_local";
  generation: number;
  command_id: string;
  occurred_at_ms: number;
  follow_up_device_ids: string[];
  responds_to_event_id: string | null;
  local_seq: number;
  digest: string;
}

export interface OriginalLifecycleFollowup {
  request: OriginalLifecycleFollowupRequest;
  resolution: "unresolved" | "manifest_known";
}

export interface OriginalLifecycleFollowupPage {
  items: OriginalLifecycleFollowup[];
  next_after: string | null;
}

export interface OriginalCacheCleanupResult {
  status: OriginalCacheCleanupStatus;
  retryable: boolean;
  reason: OriginalCacheCleanupReason | null;
  cache_presence: OriginalCachePresence;
}

export interface OriginalLifecycleApplyResult {
  receipt: OriginalLifecycleReceipt;
  status: OriginalLifecycleStatus | null;
  cache_cleanup: OriginalCacheCleanupResult;
}

export interface OriginalRestoreRetry {
  stage: {
    stage_id: string;
    profile_id: string;
    original: {
      original_id: string;
      sha256: string;
      byte_length: number;
      file_name: string;
      media_type: string;
    };
    state: "uploading";
    next_offset: number;
    generation: number;
  };
  restore_request_event_id: string;
  restore_command_id: string;
}

export interface OriginalLifecycleClient {
  capabilities(): Promise<OriginalLifecycleCapabilities>;
  status(profileId: string, originalId: string): Promise<OriginalLifecycleStatus>;
  apply(command: OriginalLifecycleCommand): Promise<OriginalLifecycleApplyResult>;
  retryRestore?(
    profileId: string,
    originalId: string,
  ): Promise<OriginalRestoreRetry | null>;
  retryCacheCleanup(
    profileId: string,
    originalId: string,
  ): Promise<OriginalCacheCleanupResult>;
  revealCache(profileId: string, originalId: string): Promise<void>;
  followups?(
    profileId: string,
    after: string | null,
    limit: number,
  ): Promise<OriginalLifecycleFollowupPage>;
}

export type OriginalLifecycleInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class OriginalLifecycleClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "unsupported" | "native" | "invalid_response",
  ) {
    super(message);
    this.name = "OriginalLifecycleClientError";
  }
}

const ACTIONS: readonly OriginalLifecycleAction[] = [
  "reclaim",
  "restore",
  "release_local",
  "purge_reclaimed",
];
const BYTE_STATES: readonly OriginalBytesState[] = [
  "available",
  "reclaimed",
  "released",
  "purged",
  "restore_pending",
  "missing",
];
const CACHE_PRESENCE: readonly OriginalCachePresence[] = [
  "present",
  "absent",
  "unknown",
];
const CLEANUP_STATUSES: readonly OriginalCacheCleanupStatus[] = [
  "complete",
  "partial",
  "recovery_required",
  "not_applicable",
];
const CLEANUP_REASONS: readonly OriginalCacheCleanupReason[] = [
  "filesystem_rejected",
  "modified",
  "unsupported",
  "unsafe_path",
  "unavailable",
  "verification_incomplete",
];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OriginalLifecycleClientError(
      "本机原件管理返回了无法识别的数据。",
      "invalid_response",
      "invalid_response",
    );
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || integer(value);
}

function invalidResponse(): OriginalLifecycleClientError {
  return new OriginalLifecycleClientError(
    "本机原件管理返回的数据与当前档案或原件不一致。",
    "invalid_response",
    "invalid_response",
  );
}

function parseCapabilities(value: unknown): OriginalLifecycleCapabilities {
  const descriptor = object(value);
  if (
    descriptor.schema_version !== ORIGINAL_LIFECYCLE_SCHEMA_VERSION ||
    !(SUPPORTED_LIFECYCLE_CORE_SCHEMAS as readonly unknown[]).includes(descriptor.core_schema) ||
    !Array.isArray(descriptor.operations) ||
    typeof descriptor.cache_policy !== "string" ||
    !["verified_same_handle", "retained"].includes(descriptor.cache_policy) ||
    typeof descriptor.supports_reveal !== "boolean" ||
    (descriptor.supports_restore_retry !== undefined &&
      typeof descriptor.supports_restore_retry !== "boolean") ||
    (descriptor.supports_followups !== undefined &&
      typeof descriptor.supports_followups !== "boolean")
  ) {
    throw new OriginalLifecycleClientError(
      "当前 Native 原件管理能力版本不兼容，尚未发起管理操作。",
      "unsupported_schema",
      "unsupported",
    );
  }
  const operations = descriptor.operations;
  if (
    operations.some(
      (action) =>
        typeof action !== "string" ||
        !(ACTIONS as readonly string[]).includes(action),
    ) ||
    new Set(operations).size !== operations.length
  ) {
    throw new OriginalLifecycleClientError(
      "当前 Native 原件管理能力声明无效，尚未发起管理操作。",
      "unsupported_capabilities",
      "unsupported",
    );
  }
  return {
    schema_version: 1,
    core_schema: descriptor.core_schema as 10 | 11,
    operations: operations as OriginalLifecycleAction[],
    cache_policy: descriptor.cache_policy as OriginalCachePolicy,
    supports_reveal: descriptor.supports_reveal,
    supports_restore_retry: descriptor.supports_restore_retry === true,
    supports_followups: descriptor.supports_followups === true,
  };
}

function parseFollowupPage(
  value: unknown,
  profileId: string,
  limit: number,
): OriginalLifecycleFollowupPage {
  const response = object(value);
  if (
    !Array.isArray(response.items) ||
    response.items.length > limit ||
    !nullableText(response.next_after)
  ) {
    throw invalidResponse();
  }
  const items: OriginalLifecycleFollowup[] = response.items.map((entry) => {
    const followup = object(entry);
    const request = object(followup.request);
    if (
      followup.resolution !== "unresolved" &&
      followup.resolution !== "manifest_known"
    ) {
      throw invalidResponse();
    }
    if (
      request.profile_id !== profileId ||
      !text(request.event_id) ||
      !text(request.device_id) ||
      !text(request.author_id) ||
      !text(request.original_id) ||
      request.action !== "release_local" ||
      !integer(request.generation) ||
      request.generation <= 0 ||
      !text(request.command_id) ||
      !integer(request.occurred_at_ms) ||
      request.occurred_at_ms < 0 ||
      !Array.isArray(request.follow_up_device_ids) ||
      request.follow_up_device_ids.length > 256 ||
      request.follow_up_device_ids.some((deviceId) => !text(deviceId)) ||
      new Set(request.follow_up_device_ids).size !==
        request.follow_up_device_ids.length ||
      !nullableText(request.responds_to_event_id) ||
      !integer(request.local_seq) ||
      request.local_seq <= 0 ||
      typeof request.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(request.digest)
    ) {
      throw invalidResponse();
    }
    return {
      request: {
        event_id: request.event_id,
        profile_id: profileId,
        device_id: request.device_id,
        author_id: request.author_id,
        original_id: request.original_id,
        action: "release_local" as const,
        generation: request.generation,
        command_id: request.command_id,
        occurred_at_ms: request.occurred_at_ms,
        follow_up_device_ids: request.follow_up_device_ids.map(
          (deviceId) => deviceId as string,
        ),
        responds_to_event_id: request.responds_to_event_id,
        local_seq: request.local_seq,
        digest: request.digest,
      },
      resolution:
        followup.resolution as OriginalLifecycleFollowup["resolution"],
    };
  });
  if (new Set(items.map((item) => item.request.event_id)).size !== items.length) {
    throw invalidResponse();
  }
  return {
    items,
    next_after: response.next_after as string | null,
  };
}

function parseRestoreRetry(
  value: unknown,
  profileId: string,
  originalId: string,
): OriginalRestoreRetry | null {
  if (value === null) return null;
  const response = object(value);
  const stage = object(response.stage);
  const original = object(stage.original);
  if (
    stage.profile_id !== profileId ||
    !text(stage.stage_id) ||
    original.original_id !== originalId ||
    !text(original.original_id) ||
    typeof original.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(original.sha256) ||
    !integer(original.byte_length) ||
    original.byte_length < 0 ||
    !text(original.file_name) ||
    !text(original.media_type) ||
    stage.state !== "uploading" ||
    !integer(stage.next_offset) ||
    stage.next_offset !== 0 ||
    !integer(stage.generation) ||
    stage.generation <= 0 ||
    !text(response.restore_request_event_id) ||
    !text(response.restore_command_id)
  ) {
    throw invalidResponse();
  }
  return {
    stage: {
      stage_id: stage.stage_id as string,
      profile_id: profileId,
      original: {
        original_id: originalId,
        sha256: original.sha256,
        byte_length: original.byte_length,
        file_name: original.file_name,
        media_type: original.media_type,
      },
      state: "uploading",
      next_offset: 0,
      generation: stage.generation,
    },
    restore_request_event_id: response.restore_request_event_id,
    restore_command_id: response.restore_command_id,
  };
}

function parseStatus(
  value: unknown,
  profileId: string,
  originalId: string,
): OriginalLifecycleStatus {
  const response = object(value);
  const lifecycle = object(response.lifecycle);
  const local = object(lifecycle.local);
  const original = object(local.original);
  if (
    local.profile_id !== profileId ||
    original.original_id !== originalId ||
    !text(original.original_id) ||
    typeof local.bytes_state !== "string" ||
    !(BYTE_STATES as readonly string[]).includes(local.bytes_state) ||
    !integer(local.generation) ||
    local.generation < 0 ||
    !nullableText(local.latest_event_id) ||
    !nullableText(local.restore_request_event_id) ||
    !nullableText(local.restore_completion_event_id) ||
    !nullableInteger(local.reclaimed_at_ms) ||
    !nullableInteger(local.recovery_window_ms) ||
    !nullableInteger(local.reclaim_deadline_ms) ||
    !Array.isArray(lifecycle.remote_sources) ||
    typeof response.cache_presence !== "string" ||
    !(CACHE_PRESENCE as readonly string[]).includes(response.cache_presence)
  ) {
    throw invalidResponse();
  }
  const remoteSources = lifecycle.remote_sources.map((entry) => {
    const source = object(entry);
    if (!text(source.device_id) || !text(source.state)) throw invalidResponse();
    return { device_id: source.device_id, state: source.state };
  });
  return {
    lifecycle: {
      local: {
        profile_id: profileId,
        original: { original_id: originalId },
        bytes_state: local.bytes_state as OriginalBytesState,
        generation: local.generation,
        latest_event_id: local.latest_event_id,
        restore_request_event_id: local.restore_request_event_id,
        restore_completion_event_id: local.restore_completion_event_id,
        reclaimed_at_ms: local.reclaimed_at_ms,
        recovery_window_ms: local.recovery_window_ms,
        reclaim_deadline_ms: local.reclaim_deadline_ms,
      },
      remote_sources: remoteSources,
    },
    cache_presence: response.cache_presence as OriginalCachePresence,
  };
}

function parseReceipt(
  value: unknown,
  command: OriginalLifecycleCommand,
): OriginalLifecycleReceipt {
  const receipt = object(value);
  if (
    receipt.command_id !== command.command_id ||
    receipt.event_id !== command.event_id ||
    receipt.profile_id !== command.profile_id ||
    !integer(receipt.local_seq) ||
    receipt.local_seq < 0 ||
    !text(receipt.event_digest) ||
    receipt.durability !== "local_committed" ||
    typeof receipt.replayed !== "boolean"
  ) {
    throw invalidResponse();
  }
  return {
    command_id: command.command_id,
    event_id: command.event_id,
    profile_id: command.profile_id,
    local_seq: receipt.local_seq,
    event_digest: receipt.event_digest,
    durability: "local_committed",
    replayed: receipt.replayed,
  };
}

function parseCleanup(value: unknown): OriginalCacheCleanupResult {
  const cleanup = object(value);
  if (
    typeof cleanup.status !== "string" ||
    !(CLEANUP_STATUSES as readonly string[]).includes(cleanup.status) ||
    typeof cleanup.retryable !== "boolean" ||
    (cleanup.reason !== null &&
      (typeof cleanup.reason !== "string" ||
        !(CLEANUP_REASONS as readonly string[]).includes(cleanup.reason))) ||
    typeof cleanup.cache_presence !== "string" ||
    !(CACHE_PRESENCE as readonly string[]).includes(cleanup.cache_presence)
  ) {
    throw invalidResponse();
  }
  return {
    status: cleanup.status as OriginalCacheCleanupStatus,
    retryable: cleanup.retryable,
    reason: cleanup.reason as OriginalCacheCleanupReason | null,
    cache_presence: cleanup.cache_presence as OriginalCachePresence,
  };
}

function isMissingCapabilityCommand(
  command: string,
  code: string,
  message: string,
): boolean {
  return (
    command === ORIGINAL_LIFECYCLE_COMMANDS.capabilities &&
    (["native_command_missing", "command_not_found", "unknown_command"].includes(
      code,
    ) ||
      (/beta_original_lifecycle_capabilities/i.test(message) &&
        /(not found|unknown command|does not exist|not registered|could not find)/i.test(
          message,
        )))
  );
}

function nativeErrorDetails(error: unknown, command: string): {
  code: string;
  message: string;
} {
  if (error && typeof error === "object") {
    const failure = error as Record<string, unknown>;
    if (text(failure.code)) {
      const message = text(failure.message) ? failure.message : failure.code;
      return {
        code: isMissingCapabilityCommand(command, failure.code, message)
          ? "native_command_missing"
          : failure.code,
        message,
      };
    }
  }
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Native 原件管理操作未确认。";
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    if (text(parsed.code)) {
      const parsedMessage = text(parsed.message) ? parsed.message : parsed.code;
      return {
        code: isMissingCapabilityCommand(command, parsed.code, parsedMessage)
          ? "native_command_missing"
          : parsed.code,
        message: parsedMessage,
      };
    }
  } catch {
    // Tauri versions may return plain strings instead of a serialized Failure.
  }
  const missingCapabilityCommand = isMissingCapabilityCommand(
    command,
    "",
    message,
  );
  if (missingCapabilityCommand) {
    return { code: "native_command_missing", message };
  }
  return { code: "native_unavailable", message };
}

function nativeError(
  error: unknown,
  command: string,
): OriginalLifecycleClientError {
  if (error instanceof OriginalLifecycleClientError) return error;
  const details = nativeErrorDetails(error, command);
  const missingCapabilityCommand = details.code === "native_command_missing";
  return new OriginalLifecycleClientError(
    missingCapabilityCommand
      ? "当前 Native 尚未接入原件管理能力；没有发起任何管理操作。"
      : details.message,
    missingCapabilityCommand ? "native_command_missing" : details.code,
    missingCapabilityCommand ? "unsupported" : "native",
  );
}

export function createOriginalLifecycleClient(
  nativeInvoke: OriginalLifecycleInvoke,
): OriginalLifecycleClient {
  async function call<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await nativeInvoke<T>(command, args);
    } catch (error) {
      throw nativeError(error, command);
    }
  }

  return {
    async capabilities() {
      return parseCapabilities(
        await call<unknown>(ORIGINAL_LIFECYCLE_COMMANDS.capabilities),
      );
    },
    async status(profileId, originalId) {
      const response = await call<unknown>(ORIGINAL_LIFECYCLE_COMMANDS.status, {
        profileId,
        originalId,
      });
      return parseStatus(response, profileId, originalId);
    },
    async apply(command) {
      const response = object(
        await call<unknown>(ORIGINAL_LIFECYCLE_COMMANDS.apply, { command }),
      );
      if (!("status" in response)) throw invalidResponse();
      const receipt = parseReceipt(response.receipt, command);
      const status =
        response.status === null
          ? null
          : parseStatus(response.status, command.profile_id, command.original_id);
      const cacheCleanup = parseCleanup(response.cache_cleanup);
      return { receipt, status, cache_cleanup: cacheCleanup };
    },
    async retryRestore(profileId, originalId) {
      return parseRestoreRetry(
        await call<unknown>(ORIGINAL_LIFECYCLE_COMMANDS.retryRestore, {
          profileId,
          originalId,
        }),
        profileId,
        originalId,
      );
    },
    async retryCacheCleanup(profileId, originalId) {
      return parseCleanup(
        await call<unknown>(ORIGINAL_LIFECYCLE_COMMANDS.retryCacheCleanup, {
          profileId,
          originalId,
        }),
      );
    },
    async revealCache(profileId, originalId) {
      await call<void>(ORIGINAL_LIFECYCLE_COMMANDS.revealCache, {
        profileId,
        originalId,
      });
    },
    async followups(profileId, after, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw invalidResponse();
      }
      return parseFollowupPage(
        await call<unknown>(ORIGINAL_LIFECYCLE_COMMANDS.followups, {
          profileId,
          limit,
          ...(after ? { after } : {}),
        }),
        profileId,
        limit,
      );
    },
  };
}

let nativeClient: OriginalLifecycleClient | null = null;

export function nativeOriginalLifecycleClient(): OriginalLifecycleClient | null {
  if (!isTauri()) return null;
  nativeClient ??= createOriginalLifecycleClient(invoke);
  return nativeClient;
}
