import {
  AgentGrantClientError,
  type AgentGrantIssueCommand,
  type AgentGrantIssueResult,
  type AgentGrantMetadata,
  type AgentGrantRole,
  type AgentGrantsClient,
} from "./agent-grants-client";

export type AgentGrantCredentialAvailability =
  | "unconfirmed"
  | "available"
  | "copied"
  | "unavailable";
export type AgentGrantRowOperation = "recover" | "copy" | "release" | "revoke" | null;
export type PendingGrantIssuePhase =
  | "issuing"
  | "recovering"
  | "uncertain"
  | "not_issued";

export interface AgentGrantRowState {
  metadata: AgentGrantMetadata;
  credentialState: AgentGrantCredentialAvailability;
  /** Opaque Native handle only. It is never rendered or logged. */
  credentialHandle: string | null;
  operation: AgentGrantRowOperation;
  message: string | null;
}

export interface PendingGrantIssue {
  command: AgentGrantIssueCommand;
  phase: PendingGrantIssuePhase;
  message: string | null;
}

export interface AgentGrantsState {
  profileId: string;
  grants: AgentGrantRowState[];
  listStatus: "idle" | "loading" | "refreshing" | "ready" | "error";
  listMessage: string | null;
  pendingIssue: PendingGrantIssue | null;
  notice: string | null;
}

export interface AgentGrantIssueLedger {
  get(profileId: string): PendingGrantIssue | null;
  begin(pending: PendingGrantIssue): number;
  update(
    profileId: string,
    grantId: string,
    attemptRevision: number,
    pending: PendingGrantIssue,
  ): boolean;
  clear(
    profileId: string,
    grantId: string,
    attemptRevision?: number,
  ): boolean;
  confirm(
    profileId: string,
    grantId: string,
    metadata: AgentGrantMetadata,
  ): void;
  publishRevoked(profileId: string, metadata: AgentGrantMetadata): void;
  subscribe(
    profileId: string,
    listener: (update: AgentGrantIssueLedgerUpdate) => void,
  ): () => void;
}

interface AgentGrantIssueLedgerUpdate {
  pending: PendingGrantIssue | null;
  grantMetadata?: AgentGrantMetadata;
}

interface AgentGrantIssueLedgerEntry {
  pending: PendingGrantIssue;
  attemptRevision: number;
}

function copyPending(
  pending: PendingGrantIssue | null,
): PendingGrantIssue | null {
  return pending ? { ...pending, command: { ...pending.command } } : null;
}

export function createAgentGrantIssueLedger(): AgentGrantIssueLedger {
  const pending = new Map<string, AgentGrantIssueLedgerEntry>();
  const listeners = new Map<
    string,
    Set<(update: AgentGrantIssueLedgerUpdate) => void>
  >();
  let nextAttemptRevision = 0;

  const publish = (
    profileId: string,
    grantMetadata?: AgentGrantMetadata,
  ) => {
    const entry = pending.get(profileId);
    const update: AgentGrantIssueLedgerUpdate = {
      pending: copyPending(entry?.pending ?? null),
      ...(grantMetadata ? { grantMetadata: { ...grantMetadata } } : {}),
    };
    for (const listener of [...(listeners.get(profileId) ?? [])])
      listener(update);
  };

  return {
    get(profileId) {
      return copyPending(pending.get(profileId.toLowerCase())?.pending ?? null);
    },
    begin(value) {
      const profileId = value.command.profile_id.toLowerCase();
      const attemptRevision = ++nextAttemptRevision;
      pending.set(profileId, {
        pending: copyPending(value)!,
        attemptRevision,
      });
      publish(profileId);
      return attemptRevision;
    },
    update(profileId, grantId, attemptRevision, value) {
      const canonicalProfileId = profileId.toLowerCase();
      const current = pending.get(canonicalProfileId);
      if (
        !current ||
        current.attemptRevision !== attemptRevision ||
        current.pending.command.grant_id !== grantId
      )
        return false;
      pending.set(canonicalProfileId, {
        pending: copyPending(value)!,
        attemptRevision,
      });
      publish(canonicalProfileId);
      return true;
    },
    clear(profileId, grantId, attemptRevision) {
      const canonicalProfileId = profileId.toLowerCase();
      const current = pending.get(canonicalProfileId);
      if (
        !current ||
        current.pending.command.grant_id !== grantId ||
        (attemptRevision !== undefined &&
          current.attemptRevision !== attemptRevision)
      )
        return false;
      pending.delete(canonicalProfileId);
      publish(canonicalProfileId);
      return true;
    },
    confirm(profileId, grantId, metadata) {
      const canonicalProfileId = profileId.toLowerCase();
      if (
        metadata.profile_id.toLowerCase() !== canonicalProfileId ||
        metadata.grant_id.toLowerCase() !== grantId.toLowerCase()
      )
        return;
      if (
        pending
          .get(canonicalProfileId)
          ?.pending.command.grant_id.toLowerCase() === grantId.toLowerCase()
      )
        pending.delete(canonicalProfileId);
      publish(canonicalProfileId, metadata);
    },
    publishRevoked(profileId, metadata) {
      const canonicalProfileId = profileId.toLowerCase();
      if (
        !metadata.revoked ||
        metadata.profile_id.toLowerCase() !== canonicalProfileId
      )
        return;
      publish(canonicalProfileId, metadata);
    },
    subscribe(profileId, listener) {
      const canonicalProfileId = profileId.toLowerCase();
      let profileListeners = listeners.get(canonicalProfileId);
      if (!profileListeners) {
        profileListeners = new Set();
        listeners.set(canonicalProfileId, profileListeners);
      }
      profileListeners.add(listener);
      return () => {
        profileListeners?.delete(listener);
        if (profileListeners?.size === 0)
          listeners.delete(canonicalProfileId);
      };
    },
  };
}

const processIssueLedger = createAgentGrantIssueLedger();

function createUuid(): string {
  const generator = globalThis.crypto?.randomUUID;
  if (typeof generator !== "function") {
    throw new AgentGrantClientError(
      "native_unavailable",
      "本机无法安全生成授权操作 ID。",
      "rejected",
    );
  }
  return generator.call(globalThis.crypto);
}

function failureFor(error: unknown, fallback: string): AgentGrantClientError {
  return error instanceof AgentGrantClientError
    ? error
    : new AgentGrantClientError("native_unavailable", fallback, "uncertain");
}

function matchesIntent(
  result: AgentGrantIssueResult,
  command: AgentGrantIssueCommand,
): boolean {
  return (
    result.grant.grant_id === command.grant_id &&
    result.grant.profile_id === command.profile_id &&
    result.grant.kind === command.kind &&
    result.grant.agent_id === command.agent_id
  );
}

function credentialAvailability(
  result: AgentGrantIssueResult,
): AgentGrantCredentialAvailability {
  if (result.grant.revoked || result.credential_state === "unavailable")
    return "unavailable";
  return result.credential_state;
}

function initialRow(metadata: AgentGrantMetadata): AgentGrantRowState {
  return {
    metadata,
    credentialState: metadata.revoked ? "unavailable" : "unconfirmed",
    credentialHandle: null,
    operation: null,
    message: null,
  };
}

function mergeGrantMetadata(
  current: AgentGrantMetadata | undefined,
  incoming: AgentGrantMetadata,
): AgentGrantMetadata {
  return {
    ...incoming,
    revoked: current?.revoked === true || incoming.revoked,
  };
}

export interface AgentGrantsControllerOptions {
  createId?: () => string;
  ledger?: AgentGrantIssueLedger;
}

/** Observes one profile scope. Native owns bounded credential material until
 * explicit release, revocation or shutdown; closing only forgets view handles. */
export class AgentGrantsController {
  private state: AgentGrantsState;
  private readonly listeners = new Set<(state: AgentGrantsState) => void>();
  private readonly createId: () => string;
  private readonly ledger: AgentGrantIssueLedger;
  private readonly recoveryFlights = new Map<string, Promise<void>>();
  private readonly confirmedGrants = new Map<string, AgentGrantMetadata>();
  private unsubscribeLedger: (() => void) | null = null;
  private active = true;
  private generation = 0;
  private listRequest = 0;
  private closing: Promise<void> | null = null;

  constructor(
    private readonly client: AgentGrantsClient,
    profileId: string,
    options: AgentGrantsControllerOptions = {},
  ) {
    const canonicalProfileId = profileId.toLowerCase();
    this.createId = options.createId ?? createUuid;
    this.ledger = options.ledger ?? processIssueLedger;
    this.state = {
      profileId: canonicalProfileId,
      grants: [],
      listStatus: "idle",
      listMessage: null,
      pendingIssue: this.ledger.get(canonicalProfileId),
      notice: null,
    };
    this.unsubscribeLedger = this.ledger.subscribe(
      canonicalProfileId,
      (update) => this.onLedgerUpdate(update),
    );
  }

  getState(): AgentGrantsState {
    return {
      ...this.state,
      grants: this.state.grants.map((row) => ({
        ...row,
        metadata: { ...row.metadata },
      })),
      pendingIssue: copyPending(this.state.pendingIssue),
    };
  }

  subscribe(listener: (state: AgentGrantsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private isCurrent(generation: number): boolean {
    return this.active && generation === this.generation;
  }

  private commit(next: AgentGrantsState): void {
    if (!this.active) return;
    this.state = next;
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private patch(patch: Partial<AgentGrantsState>): void {
    this.commit({ ...this.state, ...patch });
  }

  private patchGrant(
    grantId: string,
    update: (row: AgentGrantRowState) => AgentGrantRowState,
  ): void {
    const index = this.state.grants.findIndex(
      (row) => row.metadata.grant_id === grantId,
    );
    if (index < 0) return;
    const grants = [...this.state.grants];
    grants[index] = update(grants[index]);
    this.patch({ grants });
  }

  private beginPending(pending: PendingGrantIssue): number {
    return this.ledger.begin(pending);
  }

  private updatePending(
    pending: PendingGrantIssue,
    attemptRevision: number,
  ): boolean {
    return this.ledger.update(
      this.state.profileId,
      pending.command.grant_id,
      attemptRevision,
      pending,
    );
  }

  private clearPending(
    grantId: string,
    attemptRevision?: number,
  ): boolean {
    return this.ledger.clear(
      this.state.profileId,
      grantId,
      attemptRevision,
    );
  }

  private onLedgerUpdate(update: AgentGrantIssueLedgerUpdate): void {
    if (!this.active) return;
    let grants = this.state.grants;
    let addedMetadataRow = false;

    if (update.grantMetadata) {
      const incoming = update.grantMetadata;
      const index = grants.findIndex(
        (row) => row.metadata.grant_id === incoming.grant_id,
      );
      const current = index < 0 ? undefined : grants[index].metadata;
      const cached = this.confirmedGrants.get(incoming.grant_id);
      const previous = cached
        ? mergeGrantMetadata(current, cached)
        : current;
      const metadata = mergeGrantMetadata(previous, incoming);
      this.confirmedGrants.set(metadata.grant_id, metadata);
      if (index < 0) {
        grants = [...grants, initialRow(metadata)];
        addedMetadataRow = true;
      } else {
        grants = [...grants];
        grants[index] = {
          ...grants[index],
          metadata,
          credentialState: metadata.revoked
            ? "unavailable"
            : grants[index].credentialState,
          credentialHandle: metadata.revoked
            ? null
            : grants[index].credentialHandle,
          operation: metadata.revoked ? null : grants[index].operation,
          message: metadata.revoked
            ? "此授权已撤销；后续新请求会被拒绝，已接受的操作和回执不会回滚。"
            : grants[index].message,
        };
      }
    }

    this.patch({
      pendingIssue: copyPending(update.pending),
      ...(update.grantMetadata ? { grants } : {}),
    });
    if (addedMetadataRow) void this.refresh();
  }

  private acceptResult(
    result: AgentGrantIssueResult,
    resolvedIssueId?: string,
  ): void {
    const grantId = result.grant.grant_id;
    const previous = this.state.grants.find(
      (row) => row.metadata.grant_id === grantId,
    );
    const cached = this.confirmedGrants.get(grantId);
    const previousMetadata = cached
      ? mergeGrantMetadata(previous?.metadata, cached)
      : previous?.metadata;
    const metadata = mergeGrantMetadata(previousMetadata, result.grant);
    if (metadata.revoked) this.confirmedGrants.set(grantId, metadata);
    const effectiveResult: AgentGrantIssueResult = metadata.revoked
      ? {
          ...result,
          grant: metadata,
          credential_handle: null,
          credential_state: "unavailable",
        }
      : { ...result, grant: metadata };
    const row: AgentGrantRowState = {
      metadata,
      credentialState: credentialAvailability(effectiveResult),
      credentialHandle: metadata.revoked
        ? null
        : effectiveResult.credential_handle,
      operation: null,
      message: metadata.revoked
        ? "此授权已撤销；后续新请求会被拒绝，已接受的操作和回执不会回滚。"
        : effectiveResult.credential_state === "unavailable"
          ? "授权元数据已保留；本机没有可交接的凭据材料。请先明确撤销，再新签授权。"
          : effectiveResult.credential_state === "copied"
            ? "接入信息已复制到系统剪贴板。"
            : null,
    };
    const grants = previous
      ? this.state.grants.map((item) =>
          item.metadata.grant_id === grantId ? row : item,
        )
      : [...this.state.grants, row];
    this.patch({
      grants,
      notice: null,
      pendingIssue: this.ledger.get(this.state.profileId),
    });
    if (resolvedIssueId)
      this.ledger.confirm(this.state.profileId, resolvedIssueId, result.grant);
  }

  async refresh(): Promise<void> {
    if (!this.active) return;
    const generation = this.generation;
    const request = ++this.listRequest;
    const hasRows = this.state.grants.length > 0;
    this.patch({
      listStatus: hasRows ? "refreshing" : "loading",
      listMessage: null,
    });
    try {
      const metadata = await this.client.list(this.state.profileId);
      if (!this.isCurrent(generation) || request !== this.listRequest) return;
      const metadataById = new Map(
        metadata.map((item) => [item.grant_id, item]),
      );
      for (const [grantId, confirmed] of this.confirmedGrants) {
        const listed = metadataById.get(grantId);
        if (listed) {
          metadataById.set(
            grantId,
            mergeGrantMetadata(confirmed, listed),
          );
          if (listed.revoked) this.confirmedGrants.delete(grantId);
          else if (confirmed.revoked)
            this.confirmedGrants.set(grantId, confirmed);
        } else {
          metadataById.set(grantId, confirmed);
        }
      }
      for (const row of this.state.grants) {
        if (!row.metadata.revoked) continue;
        const listed = metadataById.get(row.metadata.grant_id);
        metadataById.set(
          row.metadata.grant_id,
          mergeGrantMetadata(row.metadata, listed ?? row.metadata),
        );
      }
      const previous = new Map(
        this.state.grants.map((row) => [row.metadata.grant_id, row]),
      );
      const grants = [...metadataById.values()].map((item) => {
        const old = previous.get(item.grant_id);
        const metadata = mergeGrantMetadata(old?.metadata, item);
        if (!old) return initialRow(metadata);
        return {
          ...old,
          metadata,
          credentialState: metadata.revoked
            ? ("unavailable" as const)
            : old.credentialState,
          credentialHandle: metadata.revoked ? null : old.credentialHandle,
          operation: metadata.revoked ? null : old.operation,
          message: metadata.revoked
            ? "此授权已撤销；后续新请求会被拒绝，已接受的操作和回执不会回滚。"
            : old.message,
        };
      });
      this.patch({
        grants,
        listStatus: "ready",
        listMessage: null,
        pendingIssue: this.ledger.get(this.state.profileId),
      });
      const pending = this.ledger.get(this.state.profileId);
      if (pending && pending.phase !== "not_issued")
        await this.recoverPendingIssue();
    } catch (error) {
      if (!this.isCurrent(generation) || request !== this.listRequest) return;
      const safe = failureFor(
        error,
        "未能读取此档案的 Agent 授权列表，请刷新后重试。",
      );
      this.patch({ listStatus: "error", listMessage: safe.message });
    }
  }

  async issue(kind: AgentGrantRole, agentId: string | null): Promise<void> {
    if (!this.active || this.ledger.get(this.state.profileId)) return;
    let grantId: string;
    try {
      grantId = this.createId();
    } catch (error) {
      const safe = failureFor(error, "本机无法安全生成授权操作 ID。");
      this.patch({ notice: safe.message });
      return;
    }
    const command: AgentGrantIssueCommand = {
      grant_id: grantId.toLowerCase(),
      profile_id: this.state.profileId,
      kind,
      agent_id: agentId?.toLowerCase() ?? null,
    };
    await this.submitIssue(command);
  }

  private async submitIssue(command: AgentGrantIssueCommand): Promise<void> {
    if (!this.active) return;
    const generation = this.generation;
    const attemptRevision = this.beginPending({
      command,
      phase: "issuing",
      message: null,
    });
    try {
      const result = await this.client.issue(command);
      if (!matchesIntent(result, command)) {
        const safe = new AgentGrantClientError(
          "invalid_response",
          "签发回执与原请求不一致；请用相同 grant ID 查证。",
          "uncertain",
        );
        const updated = this.updatePending(
          { command, phase: "uncertain", message: safe.message },
          attemptRevision,
        );
        if (updated && this.isCurrent(generation))
          this.patch({ notice: safe.message });
        return;
      }
      if (!this.isCurrent(generation)) {
        this.ledger.confirm(
          command.profile_id,
          command.grant_id,
          result.grant,
        );
        return;
      }
      this.acceptResult(result, command.grant_id);
    } catch (error) {
      const safe = failureFor(
        error,
        "签发回执未确认；请用相同 grant ID 查证，不会自动再次签发。",
      );
      if (safe.outcome === "uncertain") {
        const updated = this.updatePending(
          {
            command,
            phase: "uncertain",
            message: "签发回执未确认，正在用相同 grant ID 查证。",
          },
          attemptRevision,
        );
        if (!updated || !this.isCurrent(generation)) return;
        await this.recoverPendingIssue();
      } else if (safe.outcome === "not_found") {
        this.updatePending(
          {
            command,
            phase: "not_issued",
            message: "已查证此档案中没有该授权，可使用相同 ID 重试。",
          },
          attemptRevision,
        );
      } else {
        if (
          this.clearPending(command.grant_id, attemptRevision) &&
          this.isCurrent(generation)
        )
          this.patch({ notice: safe.message });
      }
    }
  }

  async recoverPendingIssue(): Promise<void> {
    if (!this.active) return;
    const pending = this.ledger.get(this.state.profileId);
    if (!pending || pending.phase === "not_issued") return;
    const grantId = pending.command.grant_id;
    const existing = this.recoveryFlights.get(grantId);
    if (existing) {
      await existing;
      return;
    }
    const generation = this.generation;
    const attemptRevision = this.beginPending({
      ...pending,
      phase: "recovering",
      message: "正在用相同 grant ID 查证。",
    });
    const recovery = Promise.resolve().then(() =>
      this.performPendingRecovery(pending, attemptRevision, generation),
    );
    this.recoveryFlights.set(grantId, recovery);
    try {
      await recovery;
    } finally {
      if (this.recoveryFlights.get(grantId) === recovery)
        this.recoveryFlights.delete(grantId);
    }
  }

  private async performPendingRecovery(
    pending: PendingGrantIssue,
    attemptRevision: number,
    generation: number,
  ): Promise<void> {
    try {
      const result = await this.client.recover(
        pending.command.profile_id,
        pending.command.grant_id,
      );
      if (!this.isCurrent(generation)) {
        if (
          result.grant.profile_id.toLowerCase() ===
            pending.command.profile_id.toLowerCase() &&
          result.grant.grant_id.toLowerCase() ===
            pending.command.grant_id.toLowerCase()
        ) {
          this.ledger.confirm(
            pending.command.profile_id,
            pending.command.grant_id,
            result.grant,
          );
        } else {
          this.updatePending(
            {
              ...pending,
              phase: "uncertain",
              message: "授权状态仍未确认；请保留 grant ID 并稍后查证。",
            },
            attemptRevision,
          );
        }
        return;
      }
      if (!matchesIntent(result, pending.command)) {
        const sameGrant =
          result.grant.profile_id.toLowerCase() ===
            pending.command.profile_id.toLowerCase() &&
          result.grant.grant_id.toLowerCase() ===
            pending.command.grant_id.toLowerCase();
        if (!sameGrant) {
          const message = "查证回执与原 grant ID 不一致；请保留 ID 并稍后重试。";
          if (
            this.updatePending(
              { ...pending, phase: "uncertain", message },
              attemptRevision,
            )
          )
            this.patch({ notice: message });
          return;
        }
        const metadataOnly: AgentGrantIssueResult = {
          ...result,
          credential_handle: null,
          credential_state: "unavailable",
        };
        this.acceptResult(metadataOnly, pending.command.grant_id);
        this.patch({
          notice:
            "该 grant ID 已对应其他角色；原请求未按所选角色签发。授权元数据已保留，请先核对并明确撤销后再新签。",
        });
        return;
      }
      this.acceptResult(result, pending.command.grant_id);
    } catch (error) {
      const safe = failureFor(
        error,
        "授权状态仍未确认；请保留 grant ID 并稍后查证。",
      );
      const next: PendingGrantIssue =
        safe.outcome === "not_found"
          ? {
              ...pending,
              phase: "not_issued",
              message: "已查证此档案中没有该授权，可使用相同 ID 重试。",
            }
          : { ...pending, phase: "uncertain", message: safe.message };
      if (
        this.updatePending(next, attemptRevision) &&
        this.isCurrent(generation)
      )
        this.patch({ notice: next.message });
    }
  }

  async retryUnissuedIssue(): Promise<void> {
    if (!this.active) return;
    const pending = this.ledger.get(this.state.profileId);
    if (pending?.phase !== "not_issued") return;
    await this.submitIssue(pending.command);
  }

  async recoverGrant(grantId: string): Promise<void> {
    if (!this.active) return;
    const row = this.state.grants.find(
      (item) => item.metadata.grant_id === grantId,
    );
    if (!row || row.metadata.revoked || row.operation) return;
    const generation = this.generation;
    this.patchGrant(grantId, (current) => ({
      ...current,
      operation: "recover",
      message: null,
    }));
    try {
      const result = await this.client.recover(this.state.profileId, grantId);
      if (!this.isCurrent(generation)) {
        return;
      }
      if (
        result.grant.kind !== row.metadata.kind ||
        result.grant.agent_id !== row.metadata.agent_id
      ) {
        throw new AgentGrantClientError(
          "invalid_response",
          "恢复结果与授权列表不一致；已保留原元数据。",
          "uncertain",
        );
      }
      this.acceptResult(result);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const safe = failureFor(error, "凭据状态未确认；原授权元数据仍保留。");
      this.patchGrant(grantId, (current) => ({
        ...current,
        operation: null,
        message: safe.message,
      }));
    }
  }

  async copyAccessInfo(grantId: string): Promise<void> {
    if (!this.active) return;
    const row = this.state.grants.find(
      (item) => item.metadata.grant_id === grantId,
    );
    if (!row || row.metadata.revoked || !row.credentialHandle || row.operation)
      return;
    const generation = this.generation;
    const handle = row.credentialHandle;
    this.patchGrant(grantId, (current) => ({
      ...current,
      operation: "copy",
      message: null,
    }));
    try {
      const result = await this.client.copyAccessInfo(
        this.state.profileId,
        grantId,
        handle,
      );
      if (!this.isCurrent(generation)) {
        return;
      }
      if (
        result.credential_handle !== handle ||
        result.credential_state !== "copied" ||
        result.material_retained !== true
      ) {
        throw new AgentGrantClientError(
          "invalid_response",
          "接入信息复制结果未确认；本机材料仍保留，可重试。",
          "uncertain",
        );
      }
      this.patchGrant(grantId, (current) => ({
        ...current,
        credentialState: "copied",
        operation: null,
        message: "接入信息已复制到系统剪贴板。",
      }));
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const safe = failureFor(
        error,
        "接入信息复制结果未确认；本机材料仍保留，可重试。",
      );
      if (
        safe.code === "credential_unavailable" ||
        safe.code === "grant_revoked"
      ) {
        this.patchGrant(grantId, (current) => ({
          ...current,
          credentialState: "unavailable",
          credentialHandle: null,
          operation: null,
          message: safe.message,
        }));
        if (safe.code === "grant_revoked") await this.refresh();
        return;
      }
      this.patchGrant(grantId, (current) => ({
        ...current,
        operation: null,
        message: safe.message,
      }));
    }
  }

  async revokeGrant(grantId: string): Promise<void> {
    if (!this.active) return;
    const row = this.state.grants.find(
      (item) => item.metadata.grant_id === grantId,
    );
    if (!row || row.metadata.revoked || row.operation) return;
    const generation = this.generation;
    this.patchGrant(grantId, (current) => ({
      ...current,
      operation: "revoke",
      message: null,
    }));
    try {
      const result = await this.client.revoke(this.state.profileId, grantId);
      const current = this.state.grants.find(
        (item) => item.metadata.grant_id === grantId,
      );
      const cached = this.confirmedGrants.get(grantId);
      const previous = cached
        ? mergeGrantMetadata(current?.metadata ?? row.metadata, cached)
        : current?.metadata ?? row.metadata;
      let revokedMetadata = mergeGrantMetadata(previous, result.grant);
      if (revokedMetadata.revoked)
        this.ledger.publishRevoked(this.state.profileId, revokedMetadata);
      if (!this.isCurrent(generation)) return;
      this.patchGrant(grantId, (current) => {
        const cached = this.confirmedGrants.get(grantId);
        const previous = cached
          ? mergeGrantMetadata(current.metadata, cached)
          : current.metadata;
        revokedMetadata = mergeGrantMetadata(previous, result.grant);
        return {
          ...current,
          metadata: revokedMetadata,
          credentialState: "unavailable",
          credentialHandle: null,
          operation: null,
          message:
            result.completion === "confirmed"
              ? "已撤销；后续新请求会被拒绝，已接受的操作和回执不会回滚。"
              : "撤销已确认；本机凭据材料清理未确认。后续新请求会被拒绝，已接受的操作和回执不会回滚。",
        };
      });
      this.patch({
        notice:
          result.completion === "confirmed"
            ? "授权已撤销。后续新请求会被拒绝；已接受的操作和回执不会回滚。"
            : "授权已撤销，但本机凭据材料清理未确认。已接受的操作和回执不会回滚。",
      });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const safe = failureFor(
        error,
        "撤销结果未确认；请刷新此档案的授权列表。",
      );
      this.patchGrant(grantId, (current) => ({
        ...current,
        operation: null,
        message: safe.message,
      }));
      this.patch({ notice: `${safe.message} 已接受的操作和回执不会回滚。` });
      await this.refresh();
      const current = this.state.grants.find(
        (item) => item.metadata.grant_id === grantId,
      );
      if (current?.metadata.revoked) {
        this.patch({
          notice:
            "此授权已撤销。后续新请求会被拒绝；已接受的操作和回执不会回滚。",
        });
      }
    }
  }

  /** Explicitly forget copy material, without revoking the Agent's permission. */
  async releaseCredentialMaterial(grantId: string): Promise<void> {
    if (!this.active) return;
    const row = this.state.grants.find(item => item.metadata.grant_id === grantId);
    if (!row?.credentialHandle || row.metadata.revoked || row.operation) return;
    const generation = this.generation;
    this.patchGrant(grantId, current => ({...current, operation: "release", message: null}));
    try {
      await this.client.releaseCredential(this.state.profileId, row.credentialHandle);
      if (!this.isCurrent(generation)) return;
      this.patchGrant(grantId, current => ({...current, credentialHandle: null, credentialState: "unavailable", operation: null,
        message: "本机接入材料已清除，授权仍有效；此应用中不能再复制这份凭据。"}));
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const safe = failureFor(error, "本机材料清除结果未确认；可查证凭据状态，授权没有被撤销。");
      this.patchGrant(grantId, current => ({...current, operation: null, message: safe.message}));
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (!this.active) return Promise.resolve();
    this.active = false;
    this.generation += 1;
    this.listRequest += 1;
    this.listeners.clear();
    this.unsubscribeLedger?.();
    this.unsubscribeLedger = null;
    this.state = {
      ...this.state,
      grants: this.state.grants.map((row) => ({
        ...row,
        credentialHandle: null,
        credentialState: row.metadata.revoked ? "unavailable" : "unconfirmed",
        operation: null,
      })),
      pendingIssue: this.ledger.get(this.state.profileId),
    };
    this.closing = Promise.resolve();
    return this.closing;
  }
}
