import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { betaUuid } from "./initialization";
import {
  nativeOriginalLifecycleClient,
  type OriginalLifecycleAction,
  type OriginalLifecycleClient,
  type OriginalLifecycleStatus,
} from "./original-lifecycle-client";
import {
  originalCacheCanReveal,
  originalCachePresence,
  originalLifecycleActions,
  originalLifecycleOwnerFor,
  originalLifecycleStateLabel,
  type OriginalLifecycleOwner,
  type OriginalLifecycleSnapshot,
} from "./original-lifecycle-state";

interface BetaOriginalLifecyclePanelProps {
  profileId: string;
  originalId: string;
  fileName: string;
  client?: OriginalLifecycleClient | null;
  deviceLabel?: (deviceId: string) => string;
  visible?: boolean;
  revision?: number;
}

interface ConfirmationCopy {
  title: string;
  description: string;
  confirm: string;
  destructive: boolean;
}

const EMPTY_SNAPSHOT: OriginalLifecycleSnapshot = {
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
  followupPhase: "idle",
  followups: [],
  followupNextAfter: null,
  followupMessage: "",
  message: "",
};

const NOOP_SUBSCRIBE = () => () => {};
const EMPTY_SNAPSHOT_READ = () => EMPTY_SNAPSHOT;

function actionLabel(action: OriginalLifecycleAction): string {
  switch (action) {
    case "reclaim":
      return "进入回收恢复期";
    case "restore":
      return "请求恢复本机副本";
    case "release_local":
      return "释放本机副本";
    case "purge_reclaimed":
      return "恢复期后彻底清理";
  }
}

function confirmationCopy(
  action: OriginalLifecycleAction,
  state: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"],
): ConfirmationCopy {
  switch (action) {
    case "reclaim":
      return {
        title: "登记本机副本回收？",
        description:
          "将本机副本移入回收区，恢复期内可取回；到期后仍需你手动清理。",
        confirm: "确认进入恢复期",
        destructive: false,
      };
    case "restore":
      return {
        title: "请求恢复本机副本？",
        description:
          state === "reclaimed"
            ? "将本机副本从回收区恢复为可用。"
            : "记录恢复请求。文件尚未取回时会显示待恢复；只有文件到达并校验通过后才会显示可用。",
        confirm: "确认恢复请求",
        destructive: false,
      };
    case "release_local":
      return {
        title: "立即释放本机副本？",
        description:
          "立即移除此设备、此档案内的文件副本，不经过回收期。打开用的临时副本会单独报告清理结果。",
        confirm: "确认释放本机副本",
        destructive: true,
      };
    case "purge_reclaimed":
      return {
        title: "手动彻底清理本机副本？",
        description:
          "恢复期已截止。只有再次确认后才会记录彻底清理；截止时间到达本身不会触发清理。",
        confirm: "确认彻底清理",
        destructive: true,
      };
  }
}

function deadlineText(deadlineMs: number): string {
  const date = new Date(deadlineMs);
  if (Number.isNaN(date.getTime())) return "恢复期截止时间无法显示";
  return "恢复期截止：" + date.toLocaleString();
}

function cachePresenceLabel(
  presence: "present" | "absent" | "unknown" | null,
): string {
  switch (presence) {
    case "present":
      return "打开用临时副本：存在";
    case "absent":
      return "打开用临时副本：未发现";
    case "unknown":
      return "打开用临时副本：无法确认";
    case null:
      return "打开用临时副本：尚未查询";
  }
}

function cleanupStatusLabel(status: string): string {
  switch (status) {
    case "complete":
      return "打开用临时副本清理已确认完成";
    case "partial":
      return "打开用临时副本清理只完成一部分";
    case "recovery_required":
      return "打开用临时副本需要人工检查";
    case "not_applicable":
      return "尚未执行打开缓存清理";
    default:
      return "打开用临时副本结果无法识别";
  }
}

function cleanupReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  switch (reason) {
    case "filesystem_rejected":
      return "文件系统未接受完整清理";
    case "modified":
      return "缓存内容已变化，已保留副本";
    case "unsupported":
      return "此环境不支持安全清理，已保留副本";
    case "unsafe_path":
      return "缓存路径未通过安全检查";
    case "unavailable":
      return "缓存位置暂不可用";
    case "verification_incomplete":
      return "在校验预算内未能确认完整清理";
    default:
      return "返回了未识别原因";
  }
}

function operationLabel(phase: string): string {
  switch (phase) {
    case "submitting":
      return "操作处理中";
    case "not_issued":
      return "本机尚未确认本次操作";
    case "unknown":
      return "操作结果待查证";
    case "accepted":
      return "操作回执已确认";
    case "accepted_by_status":
      return "本机状态已确认本次事件";
    default:
      return "本机操作状态";
  }
}

function isUnresolved(phase: string | undefined): boolean {
  return (
    phase === "submitting" ||
    phase === "not_issued" ||
    phase === "unknown"
  );
}

function capabilitiesMessage(snapshot: OriginalLifecycleSnapshot): string {
  if (snapshot.capabilitiesPhase === "loading") {
    return "正在确认 本机原件管理功能…";
  }
  if (snapshot.capabilitiesPhase === "unsupported") {
    return "当前版本尚不支持原件管理；可更新外心后再试。";
  }
  if (snapshot.capabilitiesPhase === "error") {
    return snapshot.message || "本机原件管理功能暂未确认。";
  }
  return "";
}

export function BetaOriginalLifecyclePanel({
  profileId,
  originalId,
  fileName,
  client: injectedClient,
  deviceLabel,
  visible = true,
  revision = 0,
}: BetaOriginalLifecyclePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] =
    useState<OriginalLifecycleAction | null>(null);
  const [respondingToEventId, setRespondingToEventId] =
    useState<string | null>(null);
  const [selectedFollowups, setSelectedFollowups] = useState<string[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const expandedRef = useRef(false);
  const visibleRef = useRef(visible);
  const ownerRef = useRef<OriginalLifecycleOwner | null>(null);
  const observedRevision = useRef(revision);
  visibleRef.current = visible;
  const panelId = useId().replace(/:/g, "");

  const client = useMemo(
    () => injectedClient === undefined
      ? nativeOriginalLifecycleClient()
      : injectedClient,
    [injectedClient],
  );
  const owner = useMemo(
    () =>
      client
        ? originalLifecycleOwnerFor(
            client,
            profileId,
            originalId,
            () => betaUuid(),
            () => Date.now(),
          )
        : null,
    [client, profileId, originalId],
  );
  ownerRef.current = owner;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!expanded || !visible || !owner) return NOOP_SUBSCRIBE();
      return owner.subscribe(listener);
    },
    [expanded, visible, owner],
  );
  const getSnapshot = useCallback(
    () => owner?.getSnapshot() ?? EMPTY_SNAPSHOT,
    [owner],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, EMPTY_SNAPSHOT_READ);

  useEffect(() => {
    if (!expanded || !visible || !owner) return;
    const openedOwner = owner;
    void openedOwner.open(
      () =>
        expandedRef.current &&
        visibleRef.current &&
        ownerRef.current === openedOwner,
    );
  }, [expanded, visible, owner]);

  useEffect(() => {
    const changed = observedRevision.current !== revision;
    observedRevision.current = revision;
    if (changed && expanded && visible && owner) {
      void Promise.all([owner.refreshStatus(), owner.refreshFollowups()]);
    }
  }, [revision, expanded, visible, owner]);

  useEffect(
    () => () => {
      expandedRef.current = false;
    },
    [],
  );

  const local = snapshot.status?.lifecycle.local ?? null;
  const remoteSources = snapshot.status?.lifecycle.remote_sources ?? [];
  const labelForDevice =
    deviceLabel ??
    ((deviceId: string) => `未命名设备 ${deviceId.slice(0, 8)}`);
  useEffect(() => {
    const available = new Set(remoteSources.map((source) => source.device_id));
    setSelectedFollowups((current) => {
      const next = current.filter((deviceId) => available.has(deviceId));
      return next.length === current.length ? current : next;
    });
  }, [remoteSources]);
  useEffect(() => {
    const deadline = local?.reclaim_deadline_ms;
    if (
      !expanded ||
      local?.bytes_state !== "reclaimed" ||
      deadline === null ||
      deadline === undefined ||
      nowMs >= deadline
    ) {
      return;
    }
    const timer = window.setTimeout(
      () => setNowMs(Date.now()),
      Math.min(deadline - nowMs, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [expanded, local?.bytes_state, local?.reclaim_deadline_ms, nowMs]);

  const actions = originalLifecycleActions(
    snapshot.status,
    snapshot.capabilities,
    nowMs,
  );
  const unresolved = isUnresolved(snapshot.operation?.phase);
  const cachePresence = originalCachePresence(snapshot);
  const confirmationDetails =
    confirmation && local
      ? confirmationCopy(confirmation, local.bytes_state)
      : null;

  function toggleExpanded() {
    const next = !expandedRef.current;
    expandedRef.current = next;
    setExpanded(next);
    if (!next) setConfirmation(null);
  }

  async function confirmAction() {
    if (!owner || !confirmation) return;
    const action = confirmation;
    const followups =
      action === "release_local" && !respondingToEventId
        ? selectedFollowups
        : [];
    const response = action === "release_local" ? respondingToEventId : null;
    setConfirmation(null);
    setRespondingToEventId(null);
    setSelectedFollowups([]);
    await owner.begin(action, followups, response);
  }

  function openAction(action: OriginalLifecycleAction) {
    setRespondingToEventId(null);
    setSelectedFollowups([]);
    setConfirmation(action);
  }

  function openIncomingRelease(eventId: string) {
    setSelectedFollowups([]);
    setRespondingToEventId(eventId);
    setConfirmation("release_local");
  }

  function toggleFollowup(deviceId: string) {
    setSelectedFollowups((current) =>
      current.includes(deviceId)
        ? current.filter((item) => item !== deviceId)
        : [...current, deviceId],
    );
  }

  return (
    <div className="min-w-0">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-9 px-2 text-xs"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={toggleExpanded}
      >
        管理本机副本
      </Button>

      {expanded && (
        <section
          id={panelId}
          aria-label={"管理本机副本：" + fileName}
          className="mt-2 space-y-3 rounded-xl border border-border-page bg-card p-3 text-sm"
        >
          {!client && (
            <p className="text-secondary" role="status">
              请在外心桌面或移动应用中管理本机副本。
            </p>
          )}

          {client && snapshot.capabilitiesPhase !== "ready" && (
            <div className="space-y-2">
              <p
                className={
                  snapshot.capabilitiesPhase === "error" ||
                  snapshot.capabilitiesPhase === "unsupported"
                    ? "text-destructive dark:text-red-300"
                    : "text-secondary"
                }
                role={
                  snapshot.capabilitiesPhase === "error" ||
                  snapshot.capabilitiesPhase === "unsupported"
                    ? "alert"
                    : "status"
                }
              >
                {capabilitiesMessage(snapshot)}
              </p>
              {(snapshot.capabilitiesPhase === "error" ||
                snapshot.capabilitiesPhase === "unsupported") && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-9"
                  onClick={() => void owner?.retryCapabilities()}
                >
                  重新检查可用功能
                </Button>
              )}
            </div>
          )}

          {snapshot.capabilitiesPhase === "ready" &&
            snapshot.capabilities?.cache_policy === "retained" && (
              <p className="text-xs text-secondary" role="status">
                本设备保留打开用的临时副本；它与档案内的原件分开管理。
              </p>
            )}

          {snapshot.capabilitiesPhase === "ready" &&
            snapshot.statusPhase === "loading" &&
            !snapshot.status && (
              <p className="text-secondary" role="status">
                正在读取此原件的本机权威状态…
              </p>
            )}

          {snapshot.capabilitiesPhase === "ready" &&
            snapshot.statusPhase === "error" && (
              <div className="space-y-2">
                <p className="text-destructive dark:text-red-300" role="alert">
                  {snapshot.message || "本机权威状态尚未确认。"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-9"
                  onClick={() => void owner?.refreshStatus()}
                >
                  重新检查本机状态
                </Button>
              </div>
            )}

          {snapshot.message &&
            snapshot.capabilitiesPhase === "ready" &&
            snapshot.statusPhase !== "error" &&
            !snapshot.operation && (
              <p className="text-destructive dark:text-red-300" role="alert">
                {snapshot.message}
              </p>
            )}

          {local && snapshot.statusPhase === "ready" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {originalLifecycleStateLabel(local.bytes_state)}
                </p>
                <p className="text-xs text-secondary">
                  {cachePresenceLabel(cachePresence)}
                </p>
              </div>

              {local.bytes_state === "reclaimed" &&
                local.reclaim_deadline_ms !== null && (
                  <p className="text-xs text-secondary">
                    {deadlineText(local.reclaim_deadline_ms)}
                  </p>
                )}

              {local.bytes_state === "restore_pending" && (
                <p className="text-xs text-secondary">
                  已记录恢复请求；本机状态仍未确认本机字节到达。
                </p>
              )}

              {local.bytes_state === "restore_pending" &&
                owner &&
                owner.canRetryRestore && (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-9"
                      disabled={
                        unresolved ||
                        snapshot.restoreRetryPhase === "running" ||
                        snapshot.cacheRetryPhase === "running" ||
                        snapshot.revealPhase === "running"
                      }
                      onClick={() => void owner.retryRestore()}
                    >
                      {snapshot.restoreRetryPhase === "running"
                        ? "正在请求重试恢复…"
                        : "重试恢复"}
                    </Button>
                    {snapshot.restoreRetryMessage && (
                      <p
                        className={
                          snapshot.restoreRetryPhase === "unknown"
                            ? "text-xs text-destructive dark:text-red-300"
                            : "text-xs text-secondary"
                        }
                        role={
                          snapshot.restoreRetryPhase === "unknown"
                            ? "alert"
                            : "status"
                        }
                      >
                        {snapshot.restoreRetryMessage}
                      </p>
                    )}
                  </div>
                )}

              {actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      type="button"
                      size="sm"
                      variant={
                        action === "release_local" ||
                        action === "purge_reclaimed"
                          ? "destructive"
                          : "outline"
                      }
                      className="min-h-9"
                      disabled={!owner || unresolved}
                      onClick={() => openAction(action)}
                    >
                      {actionLabel(action)}
                    </Button>
                  ))}
                </div>
              )}

              {local.bytes_state !== "restore_pending" &&
                snapshot.followupPhase !== "unsupported" &&
                snapshot.followupPhase !== "idle" && (
                  <div className="space-y-2 rounded-lg border border-border-page bg-surface p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">其他设备的原件跟进请求</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-9"
                        disabled={snapshot.followupPhase === "loading"}
                        onClick={() => void owner?.refreshFollowups()}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        刷新请求
                      </Button>
                    </div>
                    {snapshot.followupPhase === "loading" && (
                      <p className="text-xs text-secondary" role="status">
                        {snapshot.followupMessage || "正在读取原件请求…"}
                      </p>
                    )}
                    {snapshot.followupPhase === "error" && (
                      <p
                        className="text-xs text-destructive dark:text-red-300"
                        role="alert"
                      >
                        {snapshot.followupMessage || "原件请求尚未确认。"}
                      </p>
                    )}
                    {snapshot.followupPhase === "ready" &&
                      snapshot.followups.length === 0 &&
                      !snapshot.followupNextAfter && (
                        <p className="text-xs text-secondary">
                          当前没有来自其他设备的原件跟进请求。
                        </p>
                      )}
                    {snapshot.followups.map((followup) => (
                      <div
                        key={followup.request.event_id}
                        className="space-y-1 rounded-lg border border-border-card p-2"
                      >
                        <p className="text-xs font-medium">
                          {labelForDevice(followup.request.device_id)} 请求跟进
                        </p>
                        <p className="text-xs text-secondary">
                          {followup.resolution === "manifest_known"
                            ? "本机已有此原件的记录；请求不会自动删除本机副本。"
                            : "本机尚未确认完整的原件副本；请求不会自动获取或删除文件。"}
                        </p>
                        <p className="text-[10px] text-muted">
                          {new Date(followup.request.occurred_at_ms).toLocaleString()}
                        </p>
                        {actions.includes("release_local") && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-9"
                            disabled={unresolved}
                            onClick={() =>
                              openIncomingRelease(followup.request.event_id)
                            }
                          >
                            按此请求释放本机副本
                          </Button>
                        )}
                      </div>
                    ))}
                    {snapshot.followupMessage &&
                      snapshot.followupPhase === "ready" && (
                        <p className="text-xs text-secondary" role="status">
                          {snapshot.followupMessage}
                        </p>
                      )}
                    {snapshot.followupNextAfter && owner && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-9"
                        disabled={snapshot.followupPhase === "loading"}
                        onClick={() => void owner.loadMoreFollowups()}
                      >
                        加载更多请求
                      </Button>
                    )}
                  </div>
                )}

              {!snapshot.cacheResult &&
                originalCacheCanReveal(snapshot) &&
                owner && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    disabled={snapshot.revealPhase === "running"}
                    onClick={() => void owner.revealCache()}
                  >
                    {snapshot.revealPhase === "running"
                      ? "正在定位…"
                      : "在文件管理器中定位缓存副本"}
                  </Button>
                )}

              {local.bytes_state === "reclaimed" &&
                local.reclaim_deadline_ms !== null &&
                nowMs < local.reclaim_deadline_ms && (
                  <p className="text-xs text-secondary">
                    到达恢复期截止时间前，不能手动彻底清理。
                  </p>
                )}
            </div>
          )}

          {snapshot.cacheResult && (
            <div className="space-y-2 rounded-lg border border-border-page bg-surface p-3">
              <p className="font-medium">
                最近一次 打开用临时副本清理：
                {actionLabel(snapshot.cacheResult.action)}
              </p>
              <p className="text-xs text-secondary">
                {cleanupStatusLabel(snapshot.cacheResult.result.status)}
              </p>
              {cleanupReasonLabel(snapshot.cacheResult.result.reason) && (
                <p className="text-xs text-secondary">
                  {cleanupReasonLabel(snapshot.cacheResult.result.reason)}
                </p>
              )}
              <p className="text-xs text-secondary">
                {cachePresenceLabel(snapshot.cacheResult.result.cache_presence)}
              </p>
              <p className="text-xs text-secondary">
                此结果仅描述打开用的临时副本；未测量实际腾出的磁盘空间。
              </p>
              {!snapshot.cacheResult.result.retryable &&
                snapshot.cacheResult.result.status !== "complete" && (
                  <p className="text-xs text-secondary">
                    此结果暂不支持安全重试；原状态已保留。
                  </p>
                )}
              {snapshot.cacheRetryMessage && (
                <p
                  className={
                    snapshot.cacheRetryPhase === "error"
                      ? "text-xs text-destructive dark:text-red-300"
                      : "text-xs text-secondary"
                  }
                  role={
                    snapshot.cacheRetryPhase === "error" ? "alert" : "status"
                  }
                >
                  {snapshot.cacheRetryMessage}
                </p>
              )}
              {snapshot.revealMessage && (
                <p
                  className={
                    snapshot.revealPhase === "error"
                      ? "text-xs text-destructive dark:text-red-300"
                      : "text-xs text-secondary"
                  }
                  role={snapshot.revealPhase === "error" ? "alert" : "status"}
                >
                  {snapshot.revealMessage}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {snapshot.cacheResult.result.retryable &&
                  (local?.bytes_state === "released" ||
                    local?.bytes_state === "purged") &&
                  owner && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-9"
                      disabled={snapshot.cacheRetryPhase === "running"}
                      onClick={() => void owner.retryCacheCleanup()}
                    >
                      {snapshot.cacheRetryPhase === "running"
                        ? "正在重试缓存清理…"
                        : "重试 打开用临时副本清理"}
                    </Button>
                  )}
                {originalCacheCanReveal(snapshot) && owner && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    disabled={snapshot.revealPhase === "running"}
                    onClick={() => void owner.revealCache()}
                  >
                    {snapshot.revealPhase === "running"
                      ? "正在定位…"
                      : "在文件管理器中定位缓存副本"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {snapshot.operation && (
            <div
              className="space-y-2 rounded-lg border border-border-page bg-surface p-3"
              role={
                snapshot.operation.phase === "unknown" ? "alert" : "status"
              }
              aria-live="polite"
            >
              <p className="font-medium">
                {operationLabel(snapshot.operation.phase)}
              </p>
              <p className="text-xs text-secondary">
                {snapshot.operation.message}
              </p>

              {snapshot.operation.receipt && (
                <p className="text-xs text-secondary">
                  本机操作回执序号：
                  {snapshot.operation.receipt.local_seq}
                  {snapshot.operation.receipt.replayed
                    ? "（同一命令回放）"
                    : ""}
                  。
                </p>
              )}

              {snapshot.operation.phase === "accepted_by_status" &&
                snapshot.cacheResult?.command_id !==
                  snapshot.operation.command.command_id &&
                (snapshot.operation.command.action === "release_local" ||
                  snapshot.operation.command.action === "purge_reclaimed") && (
                  <div className="space-y-2">
                    <p className="text-xs text-secondary">
                      本次事件已由 本机状态确认；缓存清理回执未收到。当前临时副本是否存在 已单独显示，可显式重试临时副本清理。
                    </p>
                    {owner &&
                      (local?.bytes_state === "released" ||
                        local?.bytes_state === "purged") && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-9"
                          disabled={snapshot.cacheRetryPhase === "running"}
                          onClick={() => void owner.retryCacheCleanup()}
                        >
                          重试 打开用临时副本清理
                        </Button>
                      )}
                  </div>
                )}

              {snapshot.operation.phase === "not_issued" && owner && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => void owner.retrySameCommand()}
                  >
                    用相同 ID 重试
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-9"
                    onClick={() => owner.discardUnissuedDraft()}
                  >
                    放弃未发送草稿
                  </Button>
                </div>
              )}

              {snapshot.operation.phase === "unknown" &&
                snapshot.operation.reconciled &&
                owner && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-9"
                      onClick={() => void owner.retrySameCommand()}
                    >
                      用相同 ID 查证
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-9"
                      onClick={() => void owner.refreshStatus()}
                    >
                      再查权威状态
                    </Button>
                  </div>
                )}



              {owner && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-9"
                  onClick={() => void owner.refreshStatus()}
                >
                  检查本机状态
                </Button>
              )}
            </div>
          )}

          {snapshot.statusPhase === "ready" && !snapshot.operation && owner && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-9"
                onClick={() => void owner.refreshStatus()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                检查状态
              </Button>
            </div>
          )}

          <Dialog
            open={confirmation !== null}
            onOpenChange={(open) => {
              if (!open) setConfirmation(null);
            }}
          >
            {confirmationDetails && (
              <DialogContent className="beta-ui max-w-lg rounded-2xl border-border-card bg-card p-5 dark:bg-card">
                <DialogHeader>
                  <DialogTitle>{confirmationDetails.title}</DialogTitle>
                  <DialogDescription>
                    对象：{fileName}。{confirmationDetails.description}
                  </DialogDescription>
                </DialogHeader>
                {confirmation === "release_local" && respondingToEventId && (
                  <p className="text-xs text-secondary" role="status">
                    释放本机副本后，本机会记录它是对所选设备请求的明确回应。其他设备不会因此自动删除自己的副本。
                  </p>
                )}
                {confirmation === "release_local" &&
                  !respondingToEventId && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">通知其他设备跟进</p>
                      <p className="text-xs text-secondary">
                        只通知你明确选择的已授权设备；不会自动删除另一台设备上的副本。
                      </p>
                      {remoteSources.length === 0 ? (
                        <p className="text-xs text-secondary">
                          当前没有其他已授权设备可接收跟进请求。
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {remoteSources.map((source) => (
                            <Button
                              key={source.device_id}
                              type="button"
                              size="sm"
                              variant={
                                selectedFollowups.includes(source.device_id)
                                  ? "secondary"
                                  : "outline"
                              }
                              aria-label={`通知设备 ${source.device_id.slice(0, 8)} 跟进`}
                              aria-pressed={selectedFollowups.includes(
                                source.device_id,
                              )}
                              className="min-h-9"
                              onClick={() => toggleFollowup(source.device_id)}
                            >
                              {labelForDevice(source.device_id)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                <DialogFooter className="gap-2 sm:gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => setConfirmation(null)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      confirmationDetails.destructive
                        ? "destructive"
                        : "default"
                    }
                    className="min-h-9"
                    disabled={unresolved}
                    onClick={() => void confirmAction()}
                  >
                    {confirmationDetails.confirm}
                  </Button>
                </DialogFooter>
              </DialogContent>
            )}
          </Dialog>
        </section>
      )}
    </div>
  );
}
