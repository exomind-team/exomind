import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldSelect } from "@/components/ui/field-select";
import {
  AGENT_GRANT_ROLE_OPTIONS,
  type AgentGrantRole,
  type AgentGrantsClient,
} from "./agent-grants-client";
import {
  AgentGrantsController,
  type AgentGrantsState,
} from "./agent-grants-state";

export interface BetaAgentGrantsPanelProps {
  client: AgentGrantsClient | null;
  profileId: string | null;
  profileName: string | null;
  visible: boolean;
}

/** Mounting Settings only exposes the entry; opening it establishes attention. */
export function BetaAgentGrantsEntry(props: BetaAgentGrantsPanelProps) {
  const [scope, setScope] = useState<{profileId: string | null; client: AgentGrantsClient | null} | null>(null);
  const open = props.visible && scope?.profileId === props.profileId && scope?.client === props.client;
  const setOpen = (next: boolean) => setScope(next ? {profileId: props.profileId, client: props.client} : null);
  useEffect(() => { setScope(null); }, [props.visible, props.profileId, props.client]);
  if (!props.visible) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline"><KeyRound size={16} aria-hidden="true" />管理 Agent 授权</Button></DialogTrigger>
    <DialogContent className="beta-ui max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto bg-card p-4 dark:bg-card sm:p-6" closeButtonClassName="right-2 top-2 flex h-8 w-8 items-center justify-center">
      <DialogHeader className="sr-only">
        <DialogTitle>Agent 授权</DialogTitle>
        <DialogDescription>管理此设备当前档案的 Agent 权限；关闭不改变授权或本机接入材料。</DialogDescription>
      </DialogHeader>
      <BetaAgentGrantsPanel {...props} visible={open} />
      <div className="flex justify-end"><Button variant="outline" onClick={() => setOpen(false)}>关闭 Agent 授权</Button></div>
    </DialogContent>
  </Dialog>;
}

type CreateDraft = {
  profileId: string;
  role: AgentGrantRole;
  agentId: string | null;
};

type RevokeTarget = {
  profileId: string;
  grantId: string;
};

const EMPTY_STATE: Omit<AgentGrantsState, "profileId"> = {
  grants: [],
  listStatus: "idle",
  listMessage: null,
  pendingIssue: null,
  notice: null,
};

function newAgentId(): string | null {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

function roleOption(role: AgentGrantRole) {
  return AGENT_GRANT_ROLE_OPTIONS.find((option) => option.value === role)!;
}

function roleLabel(role: AgentGrantRole): string {
  return roleOption(role).label;
}

function profileScope(profileName: string | null): string {
  return profileName ?? "档案名称不可用";
}

function AgentGrantDisclosure({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-2 rounded-md py-2 text-left text-xs font-medium text-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          className={open ? "h-3.5 w-3.5 rotate-180" : "h-3.5 w-3.5"}
          aria-hidden="true"
        />
        {label}
      </button>
      <div id={regionId} hidden={!open} className="pb-2 text-xs text-secondary">
        {children}
      </div>
    </div>
  );
}

/** Settings-embedded Native grant manager for one explicitly selected profile. */
export function BetaAgentGrantsPanel({
  client,
  profileId,
  profileName,
  visible,
}: BetaAgentGrantsPanelProps) {
  const [view, setView] = useState<{
    client: AgentGrantsClient;
    profileId: string;
    owner: AgentGrantsController;
    state: AgentGrantsState;
  } | null>(null);
  const currentView =
    visible &&
    client !== null &&
    profileId !== null &&
    view !== null &&
    view.client === client &&
    view.profileId === profileId
      ? view
      : null;
  const controller = currentView?.owner ?? null;
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [materialTarget, setMaterialTarget] = useState<RevokeTarget | null>(null);

  useEffect(() => {
    setCreateDraft(null);
    setRevokeTarget(null);
    setMaterialTarget(null);
  }, [client, profileId]);

  useEffect(() => {
    if (!visible) {
      setCreateDraft(null);
      setRevokeTarget(null);
      setMaterialTarget(null);
      setView(null);
      return;
    }
    if (!client || !profileId) {
      setView(null);
      return;
    }

    const observer = new AgentGrantsController(client, profileId);
    const publish = (state: AgentGrantsState) =>
      setView({ client, profileId, owner: observer, state });
    publish(observer.getState());
    const unsubscribe = observer.subscribe(publish);
    void observer.refresh();
    return () => {
      unsubscribe();
      void observer.close();
    };
  }, [client, profileId, visible]);

  if (!visible) return null;

  const rawState =
    currentView && profileId
      ? currentView.state
      : { ...EMPTY_STATE, profileId: profileId ?? "" };
  const rows = rawState.grants;
  const pending = rawState.pendingIssue;
  const createDialogOpen = Boolean(
    createDraft && createDraft.profileId === profileId && controller,
  );
  const revokeDialogOpen = Boolean(
    revokeTarget && revokeTarget.profileId === profileId && controller,
  );
  const selectedRevokeRow =
    revokeTarget?.profileId === profileId
      ? (rows.find((row) => row.metadata.grant_id === revokeTarget.grantId) ??
        null)
      : null;
  const materialRow = materialTarget?.profileId === profileId
    ? rows.find(row => row.metadata.grant_id === materialTarget.grantId) : null;
  const canCreate = Boolean(
    controller &&
      rawState.listStatus === "ready" &&
      !pending,
  );

  const openCreate = () => {
    if (!profileId || !controller || !canCreate) return;
    setCreateDraft({ profileId, role: "observer", agentId: null });
  };

  const changeRole = (role: string) => {
    if (
      !createDraft ||
      !AGENT_GRANT_ROLE_OPTIONS.some((option) => option.value === role)
    )
      return;
    const nextRole = role as AgentGrantRole;
    const agentId =
      nextRole === "observer" ? null : (createDraft.agentId ?? newAgentId());
    setCreateDraft({ ...createDraft, role: nextRole, agentId });
  };

  const submitCreate = async () => {
    if (!controller || !createDraft || createDraft.profileId !== profileId)
      return;
    if (createDraft.role !== "observer" && !createDraft.agentId) return;
    await controller.issue(createDraft.role, createDraft.agentId);
    setCreateDraft(current => current === createDraft ? null : current);
  };

  const confirmRevoke = async () => {
    if (!controller || !selectedRevokeRow) return;
    await controller.revokeGrant(selectedRevokeRow.metadata.grant_id);
    setRevokeTarget(current => current === revokeTarget ? null : current);
  };
  const confirmReleaseMaterial = async () => {
    if (!controller || !materialRow) return;
    await controller.releaseCredentialMaterial(materialRow.metadata.grant_id);
    setMaterialTarget(current => current === materialTarget ? null : current);
  };

  const currentRole = createDraft
    ? roleOption(createDraft.role)
    : roleOption("observer");

  return (
    <section
      className="beta-ui space-y-4 text-foreground"
      aria-labelledby="beta-agent-grants-title"
    >
      <header className="space-y-1">
        <h2
          id="beta-agent-grants-title"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <KeyRound size={16} aria-hidden="true" /> Agent 授权
        </h2>
        <p className="text-sm text-secondary">
          此设备当前档案：
          <span className="font-medium text-foreground">
            {profileScope(profileName)}
          </span>
          。 这是此档案的 Agent 授权，不是设备邀请。
        </p>
      </header>

      {!client && (
        <div
          className="rounded-xl border border-border-card bg-surface p-4 text-sm text-secondary"
          role="status"
        >
          当前环境无法使用本机 Agent 授权管理。请在外心桌面或安卓应用中操作。
        </div>
      )}

      {!profileId && (
        <div className="rounded-xl border border-border-card bg-surface p-4 text-sm text-secondary">
          <p className="font-medium text-foreground">请在设置上方选择档案</p>
          <p className="mt-1">
            选择后这里只读取和管理该档案；不会自动授权其他档案。
          </p>
        </div>
      )}

      {client && profileId && controller && (
        <>
          <AgentGrantDisclosure label="查看授权能力">
            <ul className="mt-2 space-y-1 text-xs leading-5 text-secondary">
              {AGENT_GRANT_ROLE_OPTIONS.map((option) => (
                <li key={option.value}>
                  <span className="font-medium text-foreground">
                    {option.label}：
                  </span>
                  {option.description}
                </li>
              ))}
            </ul>
          </AgentGrantDisclosure>
          <AgentGrantDisclosure label="查看接入用途与可达范围">
            <p>
              本机 Beta API 供外部 Agent 按当前档案 grant 读取数据，并提供有界 Wait 和只读 Agent bundle。
              agent_note 可追加 Agent 说明与暂存原件，summary_producer 可追加外部摘要。当前 listener 只绑定回环地址，其他设备不能直接访问。
              复制的 JSON 含实际端点、设备/档案/角色信息和 bearer 凭据。
            </p>
            <p className="mt-2">
              Agent 应先 GET /hello 核对 exomind-beta/1 与设备身份，再用 access/check 查询当前授权能力。
            </p>
            <p className="mt-2">关闭本面板不改变授权或本机接入材料。材料由本机有界保存，直到明确清除、撤销授权或退出应用；剪贴板内容不会自动清除。</p>
          </AgentGrantDisclosure>

          {pending && (
            <div
              className="rounded-xl border border-border-card bg-surface p-4 text-sm text-foreground"
              role="status"
            >
              <p className="font-medium">
                {pending.phase === "issuing"
                  ? "正在签发授权…"
                  : pending.phase === "recovering"
                    ? "正在用相同 grant ID 查证…"
                    : pending.phase === "not_issued"
                      ? "已确认此档案没有该授权。"
                      : "签发结果尚未确认。"}
              </p>
              <p className="mt-1 text-xs">
                档案：{profileScope(profileName)} · 操作 ID：
                <code>{pending.command.grant_id}</code>
              </p>
              {pending.message && (
                <p className="mt-1 text-xs">{pending.message}</p>
              )}
              <AgentGrantDisclosure label="查看待查证操作范围" className="mt-2">
                <dl className="grid gap-1 border-t border-current/15 pt-2 sm:grid-cols-[auto_1fr]">
                  <dt>Profile ID</dt>
                  <dd>
                    <code>{pending.command.profile_id}</code>
                  </dd>
                  <dt>角色</dt>
                  <dd>{roleLabel(pending.command.kind)}</dd>
                  {pending.command.agent_id && (
                    <>
                      <dt>Agent ID</dt>
                      <dd>
                        <code>{pending.command.agent_id}</code>
                      </dd>
                    </>
                  )}
                </dl>
              </AgentGrantDisclosure>
              {pending.phase === "uncertain" && (
                <Button
                  type="button"
                  className="mt-3 min-h-9"
                  size="sm"
                  variant="outline"
                  onClick={() => void controller.recoverPendingIssue()}
                >
                  用相同 ID 查证
                </Button>
              )}
              {pending.phase === "not_issued" && (
                <Button
                  type="button"
                  className="mt-3 min-h-9"
                  size="sm"
                  variant="outline"
                  onClick={() => void controller.retryUnissuedIssue()}
                >
                  使用相同 ID 重试
                </Button>
              )}
            </div>
          )}

          {rawState.notice && (
            <p
              className="rounded-lg bg-surface px-3 py-2 text-sm text-secondary"
              role="status"
            >
              {rawState.notice}
            </p>
          )}
          {rawState.listMessage && (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive dark:text-red-300"
              role="alert"
            >
              {rawState.listMessage}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="min-h-9 border-brand-accent/40 bg-brand-accent/10 text-foreground hover:bg-brand-accent/15"
              size="sm"
              variant="outline"
              onClick={openCreate}
              disabled={!canCreate}
            >
              <KeyRound size={14} aria-hidden="true" /> 新建 Agent 授权
            </Button>
            <Button
              type="button"
              className="min-h-9"
              size="sm"
              variant="outline"
              onClick={() => void controller.refresh()}
              disabled={
                rawState.listStatus === "loading" ||
                rawState.listStatus === "refreshing"
              }
            >
              <RefreshCw size={14} aria-hidden="true" />
              {rawState.listStatus === "loading"
                ? "正在读取…"
                : rawState.listStatus === "refreshing"
                  ? "正在刷新…"
                  : "刷新授权列表"}
            </Button>
          </div>

          <section aria-label="当前档案的 Agent 授权列表" className="space-y-2">
            <h3 className="text-sm font-semibold">当前授权</h3>
            {rawState.listStatus === "loading" && (
              <p className="text-sm text-secondary" role="status">
                正在读取此档案的授权列表…
              </p>
            )}
            {rawState.listStatus === "error" && rows.length === 0 && (
              <p className="text-sm text-secondary">
                授权列表未确认；刷新后再签发。
              </p>
            )}
            {rawState.listStatus === "ready" && rows.length === 0 && (
              <p className="rounded-xl border border-dashed border-border-card bg-card p-4 text-sm text-secondary">
                此档案目前没有 Agent 授权。
              </p>
            )}
            {rows.map((row) => (
              <article
                key={row.metadata.grant_id}
                className="rounded-xl border border-border-card bg-card p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold">
                        {roleLabel(row.metadata.kind)}
                      </h4>
                      <span
                        className={
                          row.metadata.revoked
                            ? "rounded-full bg-muted px-2 py-0.5 text-xs text-secondary"
                            : "rounded-full bg-brand-accent/15 px-2 py-0.5 text-xs text-foreground"
                        }
                      >
                        {row.metadata.revoked ? "已撤销" : "有效"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-secondary">
                      {row.metadata.revoked
                        ? "此授权的新请求会被拒绝。"
                        : row.credentialState === "available"
                          ? "本机凭据材料可用。"
                          : row.credentialState === "copied"
                            ? "接入信息已复制到系统剪贴板。"
                            : row.credentialState === "unavailable"
                              ? "本机凭据材料不可得；授权元数据已保留。"
                              : "本机凭据状态待查证。"}
                    </p>
                    {row.message && (
                      <p
                        className={
                          row.metadata.revoked ||
                          row.credentialState === "copied" ||
                          row.credentialState === "unavailable"
                            ? "mt-1 text-xs text-secondary"
                            : "mt-1 text-xs text-destructive dark:text-red-300"
                        }
                        role={
                          row.metadata.revoked ||
                          row.credentialState === "copied" ||
                          row.credentialState === "unavailable"
                            ? "status"
                            : "alert"
                        }
                      >
                        {row.message}
                      </p>
                    )}
                  </div>
                  {!row.metadata.revoked && (
                    <div className="flex flex-wrap gap-2">
                      {(row.credentialState === "unconfirmed" ||
                        row.credentialState === "unavailable") && (
                        <Button
                          type="button"
                          className="min-h-9"
                          size="sm"
                          variant="outline"
                          disabled={!!row.operation}
                          onClick={() =>
                            void controller.recoverGrant(row.metadata.grant_id)
                          }
                        >
                          {row.operation === "recover"
                            ? "正在查证…"
                            : row.credentialState === "unavailable"
                              ? "重新查证凭据"
                              : "查证凭据"}
                        </Button>
                      )}
                      {(row.credentialState === "available" ||
                        row.credentialState === "copied") &&
                        row.credentialHandle && (
                          <Button
                            type="button"
                            className="min-h-9"
                            size="sm"
                            variant="outline"
                            disabled={!!row.operation}
                            onClick={() =>
                              void controller.copyAccessInfo(
                                row.metadata.grant_id,
                              )
                            }
                          >
                            <Copy size={14} aria-hidden="true" />
                            {row.operation === "copy"
                              ? "正在复制接入信息…"
                              : row.credentialState === "copied"
                                ? "再次复制接入信息"
                                : "复制接入信息"}
                          </Button>
                        )}
                      <Button
                        type="button"
                        className="min-h-9"
                        size="sm"
                        variant="ghost"
                        disabled={!!row.operation}
                        onClick={() =>
                          setRevokeTarget({
                            profileId,
                            grantId: row.metadata.grant_id,
                          })
                        }
                      >
                        <ShieldOff size={14} aria-hidden="true" /> 撤销此授权
                      </Button>
                    </div>
                  )}
                </div>
                <AgentGrantDisclosure
                  label="查看授权 ID 详情"
                  className="mt-3 border-t border-border-card pt-2"
                >
                  <dl className="grid gap-1 break-all sm:grid-cols-[auto_minmax(0,1fr)]">
                    <dt>Grant ID</dt>
                    <dd>
                      <code>{row.metadata.grant_id}</code>
                    </dd>
                    <dt>Profile ID</dt>
                    <dd>
                      <code>{row.metadata.profile_id}</code>
                    </dd>
                    {row.metadata.agent_id && (
                      <>
                        <dt>Agent ID</dt>
                        <dd>
                          <code>{row.metadata.agent_id}</code>
                        </dd>
                      </>
                    )}
                    <dt>角色</dt>
                    <dd>{roleLabel(row.metadata.kind)}</dd>
                  </dl>
                  {row.credentialHandle && !row.metadata.revoked && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={!!row.operation}
                    onClick={() => setMaterialTarget({profileId, grantId: row.metadata.grant_id})}>清除本机接入材料</Button>}
                </AgentGrantDisclosure>
              </article>
            ))}
          </section>

          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              if (!open) setCreateDraft(null);
            }}
          >
            <DialogContent className="beta-ui max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto rounded-2xl border-border-card bg-card p-5 dark:bg-card">
              <DialogHeader>
                <DialogTitle>确认签发 Agent 授权</DialogTitle>
                <DialogDescription>
                  本次只作用于此设备当前档案“{profileScope(profileName)}
                  ”。复制接入信息将把此授权的凭据写入系统剪贴板。
                </DialogDescription>
              </DialogHeader>
              {createDraft && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-border-card bg-surface p-3">
                    <p>
                      <span className="text-secondary">档案：</span>
                      <span className="font-medium">
                        {profileScope(profileName)}
                      </span>
                    </p>
                    <p className="mt-1">
                      <span className="text-secondary">角色：</span>
                      <span className="font-medium">{currentRole.label}</span>
                    </p>
                    <p className="mt-2 text-xs leading-5 text-secondary">
                      {currentRole.description}
                    </p>
                    <AgentGrantDisclosure label="查看档案 ID" className="mt-1">
                      <code>{createDraft.profileId}</code>
                    </AgentGrantDisclosure>
                  </div>
                  <FieldSelect
                    label="授权角色"
                    value={createDraft.role}
                    onValueChange={changeRole}
                    options={AGENT_GRANT_ROLE_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    disabled={pending !== null}
                    className="min-h-9"
                  />
                  {createDraft.role !== "observer" && (
                    <div className="rounded-lg bg-surface px-3 py-2 text-xs text-secondary">
                      <p>
                        Agent
                        ID由本机生成，并在本次签发操作中固定；无需手动输入。
                      </p>
                      {createDraft.agentId ? (
                        <AgentGrantDisclosure
                          label="查看 Agent ID"
                          className="mt-1"
                        >
                          <code>{createDraft.agentId}</code>
                        </AgentGrantDisclosure>
                      ) : (
                        <p className="mt-1 text-destructive dark:text-red-300" role="alert">
                          本机无法生成安全 Agent ID；当前不能签发。
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  type="button"
                  className="min-h-9"
                  variant="outline"
                  onClick={() => setCreateDraft(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="min-h-9"
                  variant="outline"
                  onClick={() => void submitCreate()}
                  disabled={
                    pending !== null ||
                    (createDraft?.role !== "observer" && !createDraft?.agentId)
                  }
                >
                  {pending?.phase === "issuing" ? "正在签发…" : "确认并签发"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!materialRow} onOpenChange={open => { if (!open) setMaterialTarget(null); }}>
            <DialogContent className="beta-ui max-w-lg rounded-2xl border-border-card bg-card p-5 dark:bg-card">
              <DialogHeader>
                <DialogTitle>清除本机接入材料？</DialogTitle>
                <DialogDescription>这份凭据将不能再次复制，已获得授权的 Agent 仍可继续访问。需要新凭据时，需明确撤销旧授权后重新签发。</DialogDescription>
              </DialogHeader>
              <p className="text-sm">{profileScope(profileName)} · {materialRow ? roleLabel(materialRow.metadata.kind) : ''}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMaterialTarget(null)}>取消</Button>
                <Button variant="destructive" disabled={!!materialRow?.operation} onClick={() => void confirmReleaseMaterial()}>确认清除本机材料</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={revokeDialogOpen && Boolean(selectedRevokeRow)}
            onOpenChange={(open) => {
              if (!open) setRevokeTarget(null);
            }}
          >
            <DialogContent className="beta-ui max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto rounded-2xl border-border-card bg-card p-5 dark:bg-card">
              <DialogHeader>
                <DialogTitle>撤销此 Agent 授权？</DialogTitle>
                <DialogDescription>
                  对象：{profileScope(profileName)} ·{" "}
                  {selectedRevokeRow
                    ? roleLabel(selectedRevokeRow.metadata.kind)
                    : "授权"}
                  。
                </DialogDescription>
              </DialogHeader>
              {selectedRevokeRow && (
                <div className="space-y-2 rounded-xl border border-border-card bg-surface p-3 text-sm">
                  <p className="break-all text-xs text-secondary">
                    Profile ID：
                    <code>{selectedRevokeRow.metadata.profile_id}</code>
                  </p>
                  <p className="break-all text-xs text-secondary">
                    Grant ID：<code>{selectedRevokeRow.metadata.grant_id}</code>
                  </p>
                  <p>撤销后，新请求会被拒绝；已接受的操作和回执不会回滚。</p>
                </div>
              )}
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  type="button"
                  className="min-h-9"
                  variant="outline"
                  onClick={() => setRevokeTarget(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="min-h-9"
                  variant="destructive"
                  onClick={() => void confirmRevoke()}
                >
                  确认撤销此授权
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </section>
  );
}
