import {
  OriginalLifecycleClientError,
  type OriginalBytesState,
  type OriginalCacheCleanupResult,
  type OriginalCachePresence,
  type OriginalLifecycleAction,
  type OriginalLifecycleCapabilities,
  type OriginalLifecycleClient,
  type OriginalLifecycleCommand,
  type OriginalLifecycleReceipt,
  type OriginalLifecycleStatus,
} from "./original-lifecycle-client";

export type OriginalLifecycleCapabilityPhase =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";
export type OriginalLifecycleStatusPhase = "idle" | "loading" | "ready" | "error";
export type OriginalLifecycleRestoreRetryPhase =
  | "idle"
  | "running"
  | "requested"
  | "unknown"
  | "unsupported";
export type OriginalLifecycleOperationPhase =
  | "submitting"
  | "not_issued"
  | "unknown"
  | "accepted"
  | "accepted_by_status";

export interface OriginalLifecycleOperation {
  command: OriginalLifecycleCommand;
  phase: OriginalLifecycleOperationPhase;
  receipt: OriginalLifecycleReceipt | null;
  cache_cleanup: OriginalCacheCleanupResult | null;
  reconciled: boolean;
  message: string;
}

export interface OriginalLifecycleCacheRecord {
  command_id: string;
  action: OriginalLifecycleAction;
  result: OriginalCacheCleanupResult;
  statusRevision: number;
}

export interface OriginalLifecycleSnapshot {
  capabilitiesPhase: OriginalLifecycleCapabilityPhase;
  capabilities: OriginalLifecycleCapabilities | null;
  statusPhase: OriginalLifecycleStatusPhase;
  status: OriginalLifecycleStatus | null;
  statusRevision: number;
  operation: OriginalLifecycleOperation | null;
  cacheResult: OriginalLifecycleCacheRecord | null;
  cacheRetryPhase: "idle" | "running" | "error";
  cacheRetryMessage: string;
  restoreRetryPhase: OriginalLifecycleRestoreRetryPhase;
  restoreRetryMessage: string;
  revealPhase: "idle" | "running" | "requested" | "error";
  revealMessage: string;
  message: string;
}

const INITIAL_SNAPSHOT: OriginalLifecycleSnapshot = {
  capabilitiesPhase: "idle",
  capabilities: null,
  statusPhase: "idle",
  status: null,
  statusRevision: 0,
  operation: null,
  cacheResult: null,
  cacheRetryPhase: "idle",
  cacheRetryMessage: "",
  restoreRetryPhase: "idle",
  restoreRetryMessage: "",
  revealPhase: "idle",
  revealMessage: "",
  message: "",
};

function currentLocal(
  status: OriginalLifecycleStatus | null,
): OriginalLifecycleStatus["lifecycle"]["local"] | null {
  return status?.lifecycle.local ?? null;
}

export function originalLifecycleActions(
  status: OriginalLifecycleStatus | null,
  capabilities: OriginalLifecycleCapabilities | null,
  nowMs: number,
): OriginalLifecycleAction[] {
  const local = currentLocal(status);
  if (!local || !capabilities) return [];
  const supported = capabilities.operations;
  let actions: OriginalLifecycleAction[];
  switch (local.bytes_state) {
    case "available":
      actions = ["reclaim", "release_local"];
      break;
    case "reclaimed":
      actions = ["restore", "release_local"];
      if (
        local.reclaim_deadline_ms !== null &&
        nowMs >= local.reclaim_deadline_ms
      ) {
        actions.push("purge_reclaimed");
      }
      break;
    case "released":
    case "purged":
    case "missing":
      actions = ["restore"];
      break;
    case "restore_pending":
      actions = [];
      break;
  }
  return actions.filter((action) => supported.includes(action));
}

export function originalLifecycleStateLabel(state: OriginalBytesState): string {
  switch (state) {
    case "available":
      return "本机副本可用";
    case "reclaimed":
      return "已登记回收，处于恢复期";
    case "released":
      return "本机副本已释放";
    case "purged":
      return "恢复期后已手动彻底清理";
    case "restore_pending":
      return "恢复请求已记录，字节尚未到达";
    case "missing":
      return "本机没有可用副本";
  }
}

export function originalCachePresence(
  snapshot: OriginalLifecycleSnapshot,
): OriginalCachePresence | null {
  if (
    snapshot.cacheResult &&
    snapshot.statusRevision <= snapshot.cacheResult.statusRevision
  ) {
    return snapshot.cacheResult.result.cache_presence;
  }
  return (
    snapshot.status?.cache_presence ??
    snapshot.cacheResult?.result.cache_presence ??
    null
  );
}

export function originalCacheCanReveal(
  snapshot: OriginalLifecycleSnapshot,
): boolean {
  const presence = originalCachePresence(snapshot);
  return (
    snapshot.capabilities?.supports_reveal === true &&
    presence === "present"
  );
}

function failureCode(error: unknown): string | null {
  if (
    error instanceof OriginalLifecycleClientError ||
    (error && typeof error === "object" && "code" in error)
  ) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function sameId(left: string | null, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

export class OriginalLifecycleOwner {
  private snapshot: OriginalLifecycleSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private capabilityFlight: Promise<boolean> | null = null;
  private statusSequence = 0;
  private activeRequests = 0;
  private pruneWhenIdle: (() => void) | null;

  constructor(
    private readonly client: OriginalLifecycleClient,
    readonly profileId: string,
    readonly originalId: string,
    private readonly createId: () => string,
    private readonly now: () => number,
    onIdle?: () => void,
  ) {
    this.pruneWhenIdle = onIdle ?? null;
  }

  getSnapshot = (): OriginalLifecycleSnapshot => this.snapshot;

  get canRetryRestore(): boolean {
    return (
      this.snapshot.capabilities?.supports_restore_retry === true &&
      this.snapshot.restoreRetryPhase !== "unsupported" &&
      typeof this.client.retryRestore === "function"
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.pruneIfIdle();
    };
  };

  private patch(patch: Partial<OriginalLifecycleSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async counted<T>(work: () => Promise<T>): Promise<T> {
    this.activeRequests += 1;
    try {
      return await work();
    } finally {
      this.activeRequests -= 1;
      this.pruneIfIdle();
    }
  }

  private hasUnresolvedCoreIntent(): boolean {
    const phase = this.snapshot.operation?.phase;
    return phase === "submitting" || phase === "not_issued" || phase === "unknown";
  }

  private hasUnresolvedIntent(): boolean {
    const operation = this.snapshot.operation;
    const cacheResultMatchesOperation =
      this.snapshot.cacheResult?.command_id === operation?.command.command_id;
    const awaitingNativeCacheOutcome =
      operation?.phase === "accepted_by_status" &&
      !cacheResultMatchesOperation &&
      (operation.command.action === "release_local" ||
        operation.command.action === "purge_reclaimed");
    const cacheNeedsAttention =
      this.snapshot.cacheResult?.result.status === "partial" ||
      this.snapshot.cacheResult?.result.status === "recovery_required";
    return (
      this.hasUnresolvedCoreIntent() ||
      this.snapshot.restoreRetryPhase === "unknown" ||
      awaitingNativeCacheOutcome ||
      cacheNeedsAttention
    );
  }

  private hasNativeKeyOperationInFlight(): boolean {
    return (
      this.hasUnresolvedCoreIntent() ||
      this.snapshot.restoreRetryPhase === "running" ||
      this.snapshot.restoreRetryPhase === "unknown" ||
      this.snapshot.cacheRetryPhase === "running" ||
      this.snapshot.revealPhase === "running"
    );
  }

  private pruneIfIdle(): void {
    if (
      this.listeners.size === 0 &&
      this.activeRequests === 0 &&
      !this.hasUnresolvedIntent()
    ) {
      this.pruneWhenIdle?.();
      this.pruneWhenIdle = null;
    }
  }

  private async ensureCapabilities(force = false): Promise<boolean> {
    if (!force && this.snapshot.capabilitiesPhase === "ready") return true;
    if (!force && this.snapshot.capabilitiesPhase === "unsupported") return false;
    if (this.capabilityFlight) return this.capabilityFlight;

    this.patch({
      capabilitiesPhase: "loading",
      message: "",
    });
    this.capabilityFlight = this.counted(async () => {
      try {
        const capabilities = await this.client.capabilities();
        this.patch({
          capabilities,
          capabilitiesPhase: "ready",
          message: "",
        });
        return true;
      } catch (error) {
        const unsupported =
          error instanceof OriginalLifecycleClientError &&
          error.kind === "unsupported";
        this.patch({
          capabilities: null,
          capabilitiesPhase: unsupported ? "unsupported" : "error",
          message: failureMessage(
            error,
            unsupported
              ? "当前版本尚不支持原件管理。"
              : "本机管理能力暂未确认。",
          ),
        });
        return false;
      } finally {
        this.capabilityFlight = null;
      }
    });
    return this.capabilityFlight;
  }

  async open(stillVisible: () => boolean = () => true): Promise<void> {
    if (!(await this.ensureCapabilities()) || !stillVisible()) return;
    await this.refreshStatus();
  }

  async retryCapabilities(): Promise<void> {
    if (this.snapshot.capabilitiesPhase === "loading") return;
    this.patch({
      capabilitiesPhase: "idle",
      capabilities: null,
      message: "",
    });
    if (await this.ensureCapabilities(true)) await this.refreshStatus();
  }

  async refreshStatus(): Promise<OriginalLifecycleStatus | null> {
    if (
      this.snapshot.operation?.phase === "submitting" ||
      this.snapshot.restoreRetryPhase === "running" ||
      this.snapshot.cacheRetryPhase === "running" ||
      this.snapshot.revealPhase === "running"
    ) {
      return null;
    }
    if (!(await this.ensureCapabilities())) return null;
    const sequence = ++this.statusSequence;
    this.patch({ statusPhase: "loading", message: "" });
    return this.counted(async () => {
      try {
        const status = await this.client.status(this.profileId, this.originalId);
        if (sequence !== this.statusSequence) return null;
        const restoreRetryResolved =
          this.snapshot.restoreRetryPhase === "unknown" &&
          status.lifecycle.local.bytes_state !== "restore_pending";
        this.patch({
          status,
          statusPhase: "ready",
          statusRevision: sequence,
          ...(restoreRetryResolved
            ? {
                restoreRetryPhase: "requested",
                restoreRetryMessage:
                  "本机状态已更新；恢复状态以当前结果为准。",
              }
            : {}),
          message: "",
        });
        await this.reconcileUnknownOperation(status);
        return status;
      } catch (error) {
        if (sequence === this.statusSequence) {
          this.patch({
            statusPhase: "error",
            message: failureMessage(error, "本机状态尚未确认。"),
          });
        }
        return null;
      }
    });
  }

  private async reconcileUnknownOperation(
    status: OriginalLifecycleStatus,
  ): Promise<void> {
    const operation = this.snapshot.operation;
    if (!operation || operation.phase !== "unknown") return;
    const local = status.lifecycle.local;
    if (sameId(local.latest_event_id, operation.command.event_id)) {
      this.patch({
        operation: {
          ...operation,
          phase: "accepted_by_status",
          reconciled: true,
          message:
            "本机状态已记录本次事件，但 操作回执 未收到；缓存结果仍按单独状态显示。",
        },
      });
      return;
    }
    this.patch({
      operation: {
        ...operation,
        phase: "unknown",
        reconciled: true,
        message:
          "未取得本次 操作回执；已查询权威状态，仍需用原命令 ID 查证。不会生成新 ID 自动重发。",
      },
    });
  }

  async begin(action: OriginalLifecycleAction): Promise<void> {
    const capabilities = this.snapshot.capabilities;
    const status = this.snapshot.status;
    if (
      this.snapshot.capabilitiesPhase !== "ready" ||
      this.snapshot.statusPhase !== "ready" ||
      !capabilities ||
      !status ||
      this.hasNativeKeyOperationInFlight() ||
      !originalLifecycleActions(status, capabilities, this.now()).includes(action)
    ) {
      return;
    }
    let command: OriginalLifecycleCommand;
    try {
      command = {
        command_id: this.createId(),
        event_id: this.createId(),
        profile_id: this.profileId,
        original_id: this.originalId,
        expected_generation: status.lifecycle.local.generation,
        occurred_at_ms: this.now(),
        action,
        cleanup_confirmed:
          action === "release_local" || action === "purge_reclaimed",
        follow_up_device_ids: [],
        responds_to_event_id: null,
      };
    } catch (error) {
      this.patch({
        message: failureMessage(
          error,
          "无法生成固定的本机命令 ID；没有发起管理操作。",
        ),
      });
      return;
    }
    Object.freeze(command.follow_up_device_ids);
    Object.freeze(command);
    await this.send(command);
  }

  async retrySameCommand(): Promise<void> {
    const operation = this.snapshot.operation;
    if (
      !operation ||
      !["not_issued", "unknown"].includes(operation.phase) ||
      (operation.phase === "unknown" && !operation.reconciled) ||
      this.snapshot.cacheRetryPhase === "running" ||
      this.snapshot.revealPhase === "running"
    ) {
      return;
    }
    await this.send(operation.command);
  }

  discardUnissuedDraft(): void {
    if (this.snapshot.operation?.phase !== "not_issued") return;
    this.patch({ operation: null, message: "" });
  }

  private async send(command: OriginalLifecycleCommand): Promise<void> {
    const beforeStatusSequence = this.statusSequence;
    this.patch({
      operation: {
        command,
        phase: "submitting",
        receipt: null,
        cache_cleanup: null,
        reconciled: false,
        message: "操作已提交，正在确认回执与临时副本结果。",
      },
      cacheRetryPhase: "idle",
      cacheRetryMessage: "",
      revealPhase: "idle",
      revealMessage: "",
      message: "",
    });
    await this.counted(async () => {
      try {
        const result = await this.client.apply(command);
        if (
          result.receipt.command_id !== command.command_id ||
          result.receipt.event_id !== command.event_id ||
          result.receipt.profile_id !== command.profile_id
        ) {
          throw new Error("操作回执 与本次固定命令 ID 不一致。");
        }
        const statusStillCurrent = beforeStatusSequence === this.statusSequence;
        const nextStatus =
          result.status && statusStillCurrent ? result.status : this.snapshot.status;
        this.patch({
          status: result.status ? nextStatus : null,
          statusPhase: result.status && nextStatus ? "ready" : "idle",
          cacheResult:
            command.action === "release_local" ||
            command.action === "purge_reclaimed"
              ? {
                  command_id: command.command_id,
                  action: command.action,
                  result: result.cache_cleanup,
                  statusRevision: this.statusSequence,
                }
              : this.snapshot.cacheResult,
          operation: {
            command,
            phase: "accepted",
            receipt: result.receipt,
            cache_cleanup: result.cache_cleanup,
            reconciled: true,
            message: "操作回执已确认；打开用临时副本结果已单独记录。",
          },
          message: "",
        });
      } catch (error) {
        const busyBeforeCore = failureCode(error) === "original_busy";
        this.patch({
          operation: {
            command,
            phase: busyBeforeCore ? "not_issued" : "unknown",
            receipt: null,
            cache_cleanup: null,
            reconciled: false,
            message: busyBeforeCore
              ? "本机正在处理这份文件，本次操作尚未开始。保留了本次选择，可稍后重试。"
              : "结果未确认，正在查询 本机状态；不会自动换 ID 重发。",
          },
        });
        if (!busyBeforeCore) {
          const status = await this.readStatusForReconciliation();
          if (status) await this.reconcileUnknownOperation(status);
        }
      }
    });
  }

  private async readStatusForReconciliation(): Promise<OriginalLifecycleStatus | null> {
    if (!(await this.ensureCapabilities())) return null;
    const sequence = ++this.statusSequence;
    this.patch({ statusPhase: "loading" });
    return this.counted(async () => {
      try {
        const status = await this.client.status(this.profileId, this.originalId);
        if (sequence !== this.statusSequence) return null;
        this.patch({
          status,
          statusPhase: "ready",
          statusRevision: sequence,
        });
        return status;
      } catch (error) {
        if (sequence === this.statusSequence) {
          this.patch({
            statusPhase: "error",
            message: failureMessage(error, "本机状态查询未确认。"),
          });
        }
        return null;
      }
    });
  }

  async retryCacheCleanup(): Promise<void> {
    const operation = this.snapshot.operation;
    const cacheRecord =
      this.snapshot.cacheResult?.command_id === operation?.command.command_id
        ? this.snapshot.cacheResult
        : null;
    const cleanup = cacheRecord?.result;
    const cleanupResultUnknown =
      !cleanup &&
      operation?.phase === "accepted_by_status" &&
      (operation.command.action === "release_local" ||
        operation.command.action === "purge_reclaimed");
    const bytesState = this.snapshot.status?.lifecycle.local.bytes_state;
    if (
      (!cleanupResultUnknown && !cleanup?.retryable) ||
      !this.snapshot.capabilities ||
      this.snapshot.statusPhase !== "ready" ||
      (bytesState !== "released" && bytesState !== "purged") ||
      this.snapshot.cacheRetryPhase === "running" ||
      this.snapshot.restoreRetryPhase === "running" ||
      this.snapshot.restoreRetryPhase === "unknown" ||
      this.snapshot.revealPhase === "running" ||
      this.hasUnresolvedCoreIntent()
    ) {
      return;
    }
    this.patch({
      cacheRetryPhase: "running",
      cacheRetryMessage: "正在显式重试 打开用临时副本清理。",
    });
    await this.counted(async () => {
      try {
        const result = await this.client.retryCacheCleanup(
          this.profileId,
          this.originalId,
        );
        const record =
          cacheRecord ??
          (operation
            ? {
                command_id: operation.command.command_id,
                action: operation.command.action,
                result,
                statusRevision: this.statusSequence,
              }
            : null);
        this.patch({
          cacheResult: record
            ? { ...record, result, statusRevision: this.statusSequence }
            : null,
          operation: this.snapshot.operation
            ? { ...this.snapshot.operation, cache_cleanup: result }
            : null,
          cacheRetryPhase: "idle",
          cacheRetryMessage:
            result.status === "complete"
              ? "打开用的临时副本已清理。"
              : "Native 返回新的缓存清理结果；Core 状态与回执不变。",
        });
      } catch (error) {
        this.patch({
          cacheRetryPhase: "error",
          cacheRetryMessage:
            "缓存清理重试结果未确认，正在查询本机状态；不会重放 Core 生命周期命令。 " +
            failureMessage(error, ""),
        });
        await this.readStatusForReconciliation();
      }
    });
  }

  async retryRestore(): Promise<void> {
    const retryRestore = this.client.retryRestore;
    if (
      !this.canRetryRestore ||
      !retryRestore ||
      this.snapshot.statusPhase !== "ready" ||
      this.snapshot.status?.lifecycle.local.bytes_state !== "restore_pending" ||
      this.hasUnresolvedCoreIntent() ||
      this.snapshot.restoreRetryPhase === "running" ||
      this.snapshot.cacheRetryPhase === "running" ||
      this.snapshot.revealPhase === "running"
    ) {
      return;
    }
    this.patch({
      restoreRetryPhase: "running",
      restoreRetryMessage: "正在请求恢复重试。",
    });
    await this.counted(async () => {
      try {
        await retryRestore.call(this.client, this.profileId, this.originalId);
        this.patch({
          restoreRetryPhase: "requested",
          restoreRetryMessage: "已请求恢复重试；正在重新读取本机状态。",
        });
        const status = await this.refreshStatus();
        this.patch({
          restoreRetryMessage: status
            ? "已请求恢复重试；本机状态已重新读取。"
            : "已请求恢复重试；本机状态尚未重新确认。",
        });
      } catch (error) {
        const unsupported =
          error instanceof OriginalLifecycleClientError &&
          error.kind === "unsupported";
        this.patch({
          restoreRetryPhase: unsupported ? "unsupported" : "unknown",
          restoreRetryMessage: unsupported
            ? "当前版本暂不支持恢复重试；未发出新的恢复请求。"
            : "恢复重试请求结果未确认；正在重新读取本机状态，不会自动再次请求。",
        });
        if (unsupported) return;
        const status = await this.refreshStatus();
        if (!status) {
          this.patch({
            restoreRetryMessage:
              "恢复重试请求结果与本机状态均未确认；不会自动再次请求。",
          });
        } else if (
          status.lifecycle.local.bytes_state === "restore_pending"
        ) {
          this.patch({
            restoreRetryMessage:
              "恢复重试请求结果未确认；本机状态已重新读取，不会自动再次请求。",
          });
        }
      }
    });
  }

  async revealCache(): Promise<void> {
    const capabilities = this.snapshot.capabilities;
    if (
      !capabilities?.supports_reveal ||
      !originalCacheCanReveal(this.snapshot) ||
      this.snapshot.revealPhase === "running" ||
      this.snapshot.cacheRetryPhase === "running" ||
      this.snapshot.restoreRetryPhase === "running" ||
      this.snapshot.restoreRetryPhase === "unknown" ||
      this.hasUnresolvedCoreIntent()
    ) {
      return;
    }
    this.patch({
      revealPhase: "running",
      revealMessage: "正在请求定位本机临时副本。",
    });
    await this.counted(async () => {
      try {
        await this.client.revealCache(this.profileId, this.originalId);
        this.patch({
          revealPhase: "requested",
          revealMessage: "已请求在文件管理器中定位此临时副本。",
        });
      } catch (error) {
        this.patch({
          revealPhase: "error",
          revealMessage: failureMessage(error, "文件定位结果未确认。"),
        });
      }
    });
  }
}

const ownersByClient = new WeakMap<
  OriginalLifecycleClient,
  Map<string, OriginalLifecycleOwner>
>();

export function originalLifecycleOwnerFor(
  client: OriginalLifecycleClient,
  profileId: string,
  originalId: string,
  createId: () => string,
  now: () => number,
): OriginalLifecycleOwner {
  let owners = ownersByClient.get(client);
  if (!owners) {
    owners = new Map();
    ownersByClient.set(client, owners);
  }
  const key = JSON.stringify([profileId, originalId]);
  const existing = owners.get(key);
  if (existing) return existing;
  const owner = new OriginalLifecycleOwner(
    client,
    profileId,
    originalId,
    createId,
    now,
    () => {
      if (owners?.get(key) === owner) owners.delete(key);
    },
  );
  owners.set(key, owner);
  return owner;
}
