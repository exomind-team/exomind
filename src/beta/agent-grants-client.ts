import { BetaApiError } from "./api-error";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AGENT_GRANT_ROLE_OPTIONS = [
  {
    value: "observer",
    label: "只读观察者",
    description:
      "只读本档案的记录、时间块、回顾与已提交原件；可等待新记录并导出资料清单。",
  },
  {
    value: "agent_note",
    label: "Agent说明与原件暂存",
    description: "包含观察权限，并可追加 Agent 说明与暂存原件。",
  },
  {
    value: "summary_producer",
    label: "外部摘要提交",
    description: "包含观察权限，并可追加外部 Agent 生成的回顾。",
  },
] as const;

const ROLES = AGENT_GRANT_ROLE_OPTIONS.map((option) => option.value);

export type AgentGrantRole = (typeof ROLES)[number];
export type AgentGrantIssuance = "created" | "existing" | "recovered";
export type AgentGrantCredentialState = "available" | "copied" | "unavailable";
export type AgentGrantOperationOutcome = "rejected" | "uncertain" | "not_found";
export type AgentGrantClientErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "native_unavailable"
  | "grant_issue_pending"
  | "grant_issue_unconfirmed"
  | "grant_recovery_unconfirmed"
  | "grant_revoke_unconfirmed"
  | "grant_not_found"
  | "grant_id_conflict"
  | "human_grant_not_allowed"
  | "invalid_grant_request"
  | "grant_credential_capacity"
  | "grant_revoked"
  | "credential_unavailable"
  | "copy_failed"
  | "access_denied";

export interface AgentGrantMetadata {
  grant_id: string;
  profile_id: string;
  kind: AgentGrantRole;
  agent_id: string | null;
  revoked: boolean;
}

export interface AgentGrantIssueCommand {
  grant_id: string;
  profile_id: string;
  kind: AgentGrantRole;
  agent_id: string | null;
}

export interface AgentGrantIssueResult {
  grant: AgentGrantMetadata;
  issuance: AgentGrantIssuance;
  credential_handle: string | null;
  credential_state: AgentGrantCredentialState;
}

export interface AgentGrantRevokeResult {
  grant: AgentGrantMetadata;
  credential_material_released: boolean;
  completion: "confirmed" | "revoked_cleanup_unconfirmed";
}

export interface AgentGrantCopyResult {
  credential_handle: string;
  credential_state: "copied";
  material_retained: true;
}

export interface AgentGrantReleaseResult {
  material_released: boolean;
  credential_state: "unavailable";
}

export interface AgentGrantsClient {
  list(profileId: string): Promise<AgentGrantMetadata[]>;
  issue(command: AgentGrantIssueCommand): Promise<AgentGrantIssueResult>;
  recover(profileId: string, grantId: string): Promise<AgentGrantIssueResult>;
  revoke(profileId: string, grantId: string): Promise<AgentGrantRevokeResult>;
  copyAccessInfo(
    profileId: string,
    grantId: string,
    credentialHandle: string,
  ): Promise<AgentGrantCopyResult>;
  releaseCredential(
    profileId: string,
    credentialHandle: string,
  ): Promise<AgentGrantReleaseResult>;
}

export type AgentGrantNativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class AgentGrantClientError extends BetaApiError {
  constructor(
    code: AgentGrantClientErrorCode,
    message: string,
    public readonly outcome: AgentGrantOperationOutcome = "rejected",
  ) {
    super(code, message);
    this.name = "AgentGrantClientError";
  }
}

type Operation = keyof AgentGrantsClient;

interface SafeNativeFailure {
  code: AgentGrantClientErrorCode;
  message: string;
  outcome: AgentGrantOperationOutcome;
}

const NATIVE_FAILURES: Record<string, SafeNativeFailure> = {
  human_grant_not_allowed: {
    code: "human_grant_not_allowed",
    message: "外部 Agent 授权不能使用 human 角色。",
    outcome: "rejected",
  },
  invalid_grant_request: {
    code: "invalid_grant_request",
    message: "授权角色或 Agent ID 不符合要求。",
    outcome: "rejected",
  },
  grant_id_conflict: {
    code: "grant_id_conflict",
    message: "此 grant ID 已绑定其他档案或角色，请先查证授权列表。",
    outcome: "uncertain",
  },
  grant_credential_capacity: {
    code: "grant_credential_capacity",
    message: "本机凭据材料槽已满；释放已交接材料后再签发。",
    outcome: "rejected",
  },
  grant_issue_pending: {
    code: "grant_issue_pending",
    message: "此 grant ID 仍在处理中，请继续用相同 ID 查证。",
    outcome: "uncertain",
  },
  grant_issue_unconfirmed: {
    code: "grant_issue_unconfirmed",
    message: "签发回执未确认；请用相同 grant ID 查证。",
    outcome: "uncertain",
  },
  grant_recovery_unconfirmed: {
    code: "grant_recovery_unconfirmed",
    message: "授权状态仍未确认；请保留 grant ID 并稍后查证。",
    outcome: "uncertain",
  },
  grant_management_interrupted: {
    code: "native_unavailable",
    message: "授权管理操作被中断；签发结果仍需查证。",
    outcome: "uncertain",
  },
  grant_revoke_unconfirmed: {
    code: "grant_revoke_unconfirmed",
    message: "撤销回执未确认；请刷新此档案的授权列表。",
    outcome: "uncertain",
  },
  not_found: {
    code: "grant_not_found",
    message: "此档案中未找到该授权。",
    outcome: "not_found",
  },
  grant_revoked: {
    code: "grant_revoked",
    message: "此授权已撤销，不能再复制接入信息。",
    outcome: "rejected",
  },
  credential_handle_unavailable: {
    code: "credential_unavailable",
    message: "本机凭据材料不可用；请保留授权信息并查证。",
    outcome: "rejected",
  },
  grant_credential_unavailable: {
    code: "credential_unavailable",
    message: "本机凭据材料状态未确认；授权元数据仍可读取。",
    outcome: "uncertain",
  },
  grant_clipboard_failed: {
    code: "copy_failed",
    message: "复制未确认；凭据材料仍保留，可用同一操作重试。",
    outcome: "uncertain",
  },
  invalid_request: {
    code: "invalid_request",
    message: "授权请求无效，请检查当前档案和角色。",
    outcome: "rejected",
  },
  forbidden: {
    code: "access_denied",
    message: "当前本机授权管理上下文不允许此操作。",
    outcome: "rejected",
  },
  unauthorized: {
    code: "access_denied",
    message: "当前本机授权管理上下文不允许此操作。",
    outcome: "rejected",
  },
};

const SAFE_FAILURES: Record<Operation, SafeNativeFailure> = {
  list: {
    code: "native_unavailable",
    message: "未能读取此档案的 Agent 授权列表，请刷新后重试。",
    outcome: "uncertain",
  },
  issue: {
    code: "native_unavailable",
    message: "签发回执未确认；请用相同 grant ID 查证，不会自动再次签发。",
    outcome: "uncertain",
  },
  recover: {
    code: "native_unavailable",
    message: "授权状态未确认；请保留 grant ID 并稍后查证。",
    outcome: "uncertain",
  },
  revoke: {
    code: "native_unavailable",
    message: "撤销结果未确认；请刷新此档案的授权列表。",
    outcome: "uncertain",
  },
  copyAccessInfo: {
    code: "native_unavailable",
    message: "接入信息复制结果未确认；本机材料仍保留，可重试。",
    outcome: "uncertain",
  },
  releaseCredential: {
    code: "native_unavailable",
    message: "本机凭据材料释放未确认；授权本身未因此撤销。",
    outcome: "uncertain",
  },
};

function invalidRequest(): AgentGrantClientError {
  return new AgentGrantClientError(
    "invalid_request",
    "授权请求字段无效或超出支持范围。",
  );
}

function invalidResponse(): AgentGrantClientError {
  return new AgentGrantClientError(
    "invalid_response",
    "本机返回的授权数据与当前请求不一致。",
    "uncertain",
  );
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalidResponse();
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function assertUuid(value: unknown): asserts value is string {
  if (!isUuid(value)) throw invalidRequest();
}

function validateIssueCommand(value: unknown): AgentGrantIssueCommand {
  const command = asObject(value);
  if (!hasExactKeys(command, ["grant_id", "profile_id", "kind", "agent_id"]))
    throw invalidRequest();
  assertUuid(command.grant_id);
  assertUuid(command.profile_id);
  if (
    typeof command.kind !== "string" ||
    !(ROLES as readonly string[]).includes(command.kind)
  )
    throw invalidRequest();
  if (command.kind === "observer") {
    if (command.agent_id !== null) throw invalidRequest();
  } else {
    assertUuid(command.agent_id);
  }
  return {
    grant_id: command.grant_id.toLowerCase(),
    profile_id: command.profile_id.toLowerCase(),
    kind: command.kind as AgentGrantRole,
    agent_id:
      typeof command.agent_id === "string"
        ? command.agent_id.toLowerCase()
        : null,
  };
}

function validateRole(kind: unknown, agentId: unknown): kind is AgentGrantRole {
  if (typeof kind !== "string" || !(ROLES as readonly string[]).includes(kind))
    return false;
  return kind === "observer" ? agentId === null : isUuid(agentId);
}

function parseMetadata(value: unknown, profileId: string): AgentGrantMetadata {
  const item = asObject(value);
  if (
    !hasExactKeys(item, [
      "grant_id",
      "profile_id",
      "kind",
      "agent_id",
      "revoked",
    ]) ||
    !isUuid(item.grant_id) ||
    item.profile_id !== profileId ||
    !isUuid(item.profile_id) ||
    !validateRole(item.kind, item.agent_id) ||
    typeof item.revoked !== "boolean"
  ) {
    throw invalidResponse();
  }
  return {
    grant_id: item.grant_id,
    profile_id: item.profile_id,
    kind: item.kind,
    agent_id: item.agent_id as string | null,
    revoked: item.revoked,
  };
}

function parseIssueResult(
  value: unknown,
  profileId: string,
  grantId: string,
  intent?: AgentGrantIssueCommand,
): AgentGrantIssueResult {
  const item = asObject(value);
  if (
    !hasExactKeys(item, [
      "grant",
      "issuance",
      "credential_handle",
      "credential_state",
    ]) ||
    !["created", "existing", "recovered"].includes(String(item.issuance)) ||
    !["available", "copied", "unavailable"].includes(
      String(item.credential_state),
    )
  ) {
    throw invalidResponse();
  }
  const grant = parseMetadata(item.grant, profileId);
  if (
    grant.grant_id !== grantId ||
    (intent &&
      (grant.kind !== intent.kind || grant.agent_id !== intent.agent_id))
  ) {
    throw invalidResponse();
  }
  const credentialHandle = item.credential_handle;
  const credentialState = item.credential_state as AgentGrantCredentialState;
  if (
    (credentialState === "unavailable" && credentialHandle !== null) ||
    (credentialState !== "unavailable" && !isUuid(credentialHandle)) ||
    (grant.revoked && credentialState !== "unavailable")
  ) {
    throw invalidResponse();
  }
  return {
    grant,
    issuance: item.issuance as AgentGrantIssuance,
    credential_handle: credentialHandle as string | null,
    credential_state: credentialState,
  };
}

function errorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  if (typeof error === "string") {
    try {
      const parsed: unknown = JSON.parse(error);
      const value = asObject(parsed);
      return typeof value.code === "string" ? value.code : null;
    } catch {
      return null;
    }
  }
  if (error instanceof Error) {
    try {
      const parsed: unknown = JSON.parse(error.message);
      const value = asObject(parsed);
      return typeof value.code === "string" ? value.code : null;
    } catch {
      return null;
    }
  }
  return null;
}

function safeFailure(
  operation: Operation,
  error: unknown,
): AgentGrantClientError {
  const nativeCode = errorCode(error) ?? "";
  const known = Object.prototype.hasOwnProperty.call(
    NATIVE_FAILURES,
    nativeCode,
  )
    ? NATIVE_FAILURES[nativeCode]
    : undefined;
  if (known) {
    if (nativeCode === "grant_management_interrupted") {
      const fallback = SAFE_FAILURES[operation];
      return new AgentGrantClientError(
        fallback.code,
        fallback.message,
        fallback.outcome,
      );
    }
    // A missing grant during recovery proves only that the requested profile
    // has no such grant. An issue error must retain its own safer classification.
    if (operation === "issue" && known.outcome === "not_found") {
      return new AgentGrantClientError(
        "grant_not_found",
        known.message,
        "rejected",
      );
    }
    return new AgentGrantClientError(known.code, known.message, known.outcome);
  }
  const fallback = SAFE_FAILURES[operation];
  return new AgentGrantClientError(
    fallback.code,
    fallback.message,
    fallback.outcome,
  );
}

function requestUuid(value: string): string {
  assertUuid(value);
  return value.toLowerCase();
}

/** Narrow adapter for the six Native commands. The renderer receives metadata
 * and opaque handles only; clipboard access remains inside Native. */
export function createAgentGrantsClient(
  call: AgentGrantNativeInvoke,
): AgentGrantsClient {
  async function invoke<T>(
    operation: Operation,
    command: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await call<T>(command, args);
    } catch (error) {
      throw safeFailure(operation, error);
    }
  }

  return {
    async list(profileId) {
      const normalizedProfileId = requestUuid(profileId);
      const value = await invoke<unknown>("list", "beta_grant_metadata_list", {
        profileId: normalizedProfileId,
      });
      if (!Array.isArray(value)) throw invalidResponse();
      const grants = value.map((item) =>
        parseMetadata(item, normalizedProfileId),
      );
      const ids = new Set<string>();
      for (const grant of grants) {
        if (ids.has(grant.grant_id)) throw invalidResponse();
        ids.add(grant.grant_id);
      }
      return grants;
    },

    async issue(input) {
      const command = validateIssueCommand(input);
      const value = await invoke<unknown>("issue", "beta_grant_issue", {
        command,
      });
      return parseIssueResult(
        value,
        command.profile_id,
        command.grant_id,
        command,
      );
    },

    async recover(profileId, grantId) {
      const normalizedProfileId = requestUuid(profileId);
      const normalizedGrantId = requestUuid(grantId);
      const value = await invoke<unknown>("recover", "beta_grant_recover", {
        profileId: normalizedProfileId,
        grantId: normalizedGrantId,
      });
      return parseIssueResult(value, normalizedProfileId, normalizedGrantId);
    },

    async revoke(profileId, grantId) {
      const normalizedProfileId = requestUuid(profileId);
      const normalizedGrantId = requestUuid(grantId);
      const value = await invoke<unknown>("revoke", "beta_grant_revoke", {
        profileId: normalizedProfileId,
        grantId: normalizedGrantId,
      });
      const item = asObject(value);
      if (
        !hasExactKeys(item, [
          "grant",
          "credential_material_released",
          "completion",
        ]) ||
        typeof item.credential_material_released !== "boolean" ||
        !["confirmed", "revoked_cleanup_unconfirmed"].includes(
          String(item.completion),
        )
      ) {
        throw invalidResponse();
      }
      const grant = parseMetadata(item.grant, normalizedProfileId);
      if (grant.grant_id !== normalizedGrantId || !grant.revoked)
        throw invalidResponse();
      return {
        grant,
        credential_material_released: item.credential_material_released,
        completion: item.completion as AgentGrantRevokeResult["completion"],
      };
    },

    async copyAccessInfo(profileId, grantId, credentialHandle) {
      const normalizedProfileId = requestUuid(profileId);
      const normalizedGrantId = requestUuid(grantId);
      const normalizedHandle = requestUuid(credentialHandle);
      const value = await invoke<unknown>(
        "copyAccessInfo",
        "beta_grant_copy_access_info",
        {
          profileId: normalizedProfileId,
          grantId: normalizedGrantId,
          credentialHandle: normalizedHandle,
        },
      );
      const item = asObject(value);
      if (
        !hasExactKeys(item, [
          "credential_handle",
          "credential_state",
          "material_retained",
        ]) ||
        item.credential_handle !== normalizedHandle ||
        item.credential_state !== "copied" ||
        item.material_retained !== true
      ) {
        throw invalidResponse();
      }
      return {
        credential_handle: normalizedHandle,
        credential_state: "copied",
        material_retained: true,
      };
    },

    async releaseCredential(profileId, credentialHandle) {
      const normalizedProfileId = requestUuid(profileId);
      const normalizedHandle = requestUuid(credentialHandle);
      const value = await invoke<unknown>(
        "releaseCredential",
        "beta_grant_release_credential",
        {
          profileId: normalizedProfileId,
          credentialHandle: normalizedHandle,
        },
      );
      const item = asObject(value);
      if (
        !hasExactKeys(item, ["material_released", "credential_state"]) ||
        typeof item.material_released !== "boolean" ||
        item.credential_state !== "unavailable"
      ) {
        throw invalidResponse();
      }
      return {
        material_released: item.material_released,
        credential_state: "unavailable",
      };
    },
  };
}
