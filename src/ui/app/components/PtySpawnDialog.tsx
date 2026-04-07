import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Terminal } from "lucide-react";
import { detectAndPersistHistoricalSessionId } from "@/ui/app/pages/agents/pty-session-recovery";

// ── Types ──────────────────────────────────────────────────────

type PtyAgentType = "claude" | "codex" | "custom";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type PtyDialogMode = "route" | "create" | "resume";

interface HistoricalSessionInfo {
  agent_type: Exclude<PtyAgentType, "custom">;
  session_id: string;
  project_path: string;
  last_modified: string; // ISO 8601
  display_title?: string;
  display_path?: string;
  first_user_message_preview?: string;
  last_user_message_preview?: string;
  first_user_message?: string;
  last_user_message?: string;
}

const HISTORICAL_SESSION_PREVIEW_CHAR_LIMIT = 200;
const HISTORICAL_SESSION_PRIMARY_LABEL_CHAR_LIMIT = 80;

export interface PtySpawnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rtBaseUrl: string;
  authToken?: string;
  defaultWorkdir?: string;
  onSpawned: (info: { id: string; name: string }) => void;
  occupiedHistoricalSessionIds?: string[];
  occupiedHistoricalSessionLabels?: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return isoString;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "刚刚";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;

  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function parseExtraArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function sanitizeHistoricalSessionPathLabel(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  // Claude fallback folders can surface as opaque drive slugs like `H--A137442-...`.
  // They are not readable project paths and should not occupy the title/path slots.
  if (/^[a-z]--[^\\/]+$/i.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function normalizeHistoricalSessionText(value?: string | null): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function shortenHistoricalSessionId(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return trimmed.slice(0, 12);
}

function resolveHistoricalSessionPrimaryLabel(
  session: HistoricalSessionInfo,
): string {
  const displayTitle = normalizeHistoricalSessionText(session.display_title);
  if (displayTitle) {
    return displayTitle;
  }

  const previewTitle = truncateUnicodeText(
    normalizeHistoricalSessionText(
      session.first_user_message_preview ??
        session.first_user_message ??
        session.last_user_message_preview ??
        session.last_user_message,
    ),
    HISTORICAL_SESSION_PRIMARY_LABEL_CHAR_LIMIT,
  );
  if (previewTitle) {
    return previewTitle;
  }

  const displayPath = sanitizeHistoricalSessionPathLabel(session.display_path);
  if (displayPath) {
    return displayPath;
  }

  const projectPath = sanitizeHistoricalSessionPathLabel(session.project_path);
  if (projectPath) {
    return projectPath;
  }

  return shortenHistoricalSessionId(session.session_id);
}

function resolveHistoricalSessionPathLabel(
  session: HistoricalSessionInfo,
): string {
  const pathLabel =
    sanitizeHistoricalSessionPathLabel(session.display_path) ||
    sanitizeHistoricalSessionPathLabel(session.project_path) ||
    "";
  if (
    !pathLabel ||
    pathLabel === resolveHistoricalSessionPrimaryLabel(session)
  ) {
    return "";
  }
  return pathLabel;
}

function resolveHistoricalSessionSecondaryTitle(
  session: HistoricalSessionInfo,
): string {
  const title = normalizeHistoricalSessionText(session.display_title);
  if (!title || title === resolveHistoricalSessionPrimaryLabel(session)) {
    return "";
  }
  return title;
}

function truncateUnicodeText(value: string, limit: number): string {
  const chars = Array.from(value);
  if (chars.length <= limit) {
    return value;
  }
  if (limit <= 0) {
    return "";
  }
  return `${chars.slice(0, limit - 1).join("")}…`;
}

function resolveHistoricalSessionPreview(value?: string | null): string {
  const normalized = normalizeHistoricalSessionText(value);
  if (!normalized) {
    return "";
  }
  return truncateUnicodeText(normalized, HISTORICAL_SESSION_PREVIEW_CHAR_LIMIT);
}

// ── Component ──────────────────────────────────────────────────

export function PtySpawnDialog({
  open,
  onOpenChange,
  rtBaseUrl,
  authToken,
  defaultWorkdir,
  onSpawned,
  occupiedHistoricalSessionIds = [],
  occupiedHistoricalSessionLabels = {},
}: PtySpawnDialogProps) {
  const [dialogMode, setDialogMode] = useState<PtyDialogMode>("route");
  const [agentType, setAgentType] = useState<PtyAgentType>("claude");
  const [name, setName] = useState("");
  const [workdir, setWorkdir] = useState(defaultWorkdir || "");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("xhigh");
  const [customCommand, setCustomCommand] = useState("");
  const [extraArgs, setExtraArgs] = useState("");
  const [sessions, setSessions] = useState<HistoricalSessionInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const occupiedHistoricalSessionIdSet = new Set(occupiedHistoricalSessionIds);

  // ── Build auth headers ──────────────────────────────────────

  const buildHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    return headers;
  }, [authToken]);

  // ── Reset state when dialog closes ──────────────────────────

  useEffect(() => {
    if (!open) {
      setDialogMode("route");
      setAgentType("claude");
      setName("");
      setWorkdir(defaultWorkdir || "");
      setModel("");
      setReasoningEffort("xhigh");
      setCustomCommand("");
      setExtraArgs("");
      setSessions([]);
      setHistoryLoading(false);
      setLoading(false);
      setError("");
    }
  }, [open, defaultWorkdir]);

  // ── Fetch historical sessions on open / type switch ─────────

  useEffect(() => {
    if (!open || dialogMode === "route") return;
    if (agentType === "custom") {
      setSessions([]);
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;

    const fetchSessions = async () => {
      try {
        setHistoryLoading(true);
        const headers: Record<string, string> = {};
        if (authToken) {
          headers["Authorization"] = `Bearer ${authToken}`;
        }
        const res = await fetch(
          `${rtBaseUrl}/pty/sessions?agent_type=${agentType}`,
          { headers },
        );
        if (!res.ok) {
          // Non-critical: sessions list is optional
          if (!cancelled) setSessions([]);
          return;
        }
        const data: HistoricalSessionInfo[] = await res.json();
        if (!cancelled) {
          setSessions(
            data.filter((session) => session.agent_type === agentType),
          );
        }
      } catch {
        // Silently ignore — session list is a convenience feature
        if (!cancelled) {
          setSessions([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    void fetchSessions();

    return () => {
      cancelled = true;
    };
  }, [open, dialogMode, agentType, rtBaseUrl, authToken]);

  const changeDialogMode = useCallback(
    (nextMode: PtyDialogMode) => {
      setDialogMode(nextMode);
      setError("");
      if (nextMode === "resume" && agentType === "custom") {
        setAgentType("claude");
      }
    },
    [agentType],
  );

  const buildSpawnPayload = useCallback(() => {
    const args: string[] = [];
    let command = "claude";

    if (agentType === "claude") {
      command = "claude";
      if (model.trim()) {
        args.push("--model", model.trim());
      }
    } else if (agentType === "codex") {
      command = "codex";
      if (model.trim()) {
        args.push("-m", model.trim());
      }
      if (reasoningEffort.trim()) {
        args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
      }
    } else {
      command = customCommand.trim();
    }

    args.push(...parseExtraArgs(extraArgs));

    const body: {
      name?: string;
      workdir?: string;
      command: string;
      args: string[];
      rows: number;
      cols: number;
    } = {} as {
      name?: string;
      workdir?: string;
      command: string;
      args: string[];
      rows: number;
      cols: number;
    };

    if (name.trim()) body.name = name.trim();
    if (workdir.trim()) body.workdir = workdir.trim();
    body.command = command;
    body.args = args;
    body.rows = 24;
    body.cols = 80;

    return body;
  }, [
    agentType,
    customCommand,
    extraArgs,
    model,
    name,
    reasoningEffort,
    workdir,
  ]);

  // ── Spawn new session ───────────────────────────────────────

  const handleSpawn = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const body = buildSpawnPayload();
      const startedAtMs = Date.now();

      const res = await fetch(`${rtBaseUrl}/pty/spawn`, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const result: { id: string; name: string; workdir?: string } =
        await res.json();
      if (agentType === "claude" || agentType === "codex") {
        const resolvedWorkdir =
          typeof result.workdir === "string" && result.workdir.trim()
            ? result.workdir.trim()
            : typeof body.workdir === "string"
              ? body.workdir
              : workdir.trim();
        void detectAndPersistHistoricalSessionId({
          rtBaseUrl,
          authToken,
          sessionRecordId: result.id,
          agentType,
          baselineSessionIds: sessions.map((session) => session.session_id),
          expectedWorkdir: resolvedWorkdir,
          startedAtMs,
        }).catch((persistError) => {
          console.warn(
            "[agent-hub][pty] failed to persist spawned terminal inner session id",
            {
              ptyId: result.id,
              agentType,
              expectedWorkdir: resolvedWorkdir,
              message:
                persistError instanceof Error
                  ? persistError.message
                  : String(persistError),
            },
          );
        });
      }
      onSpawned(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    agentType,
    buildHeaders,
    buildSpawnPayload,
    onOpenChange,
    onSpawned,
    authToken,
    rtBaseUrl,
    sessions,
    workdir,
  ]);

  // ── Resume existing session ─────────────────────────────────

  const handleResume = useCallback(
    async (session: HistoricalSessionInfo) => {
      setLoading(true);
      setError("");

      try {
        const parsedExtraArgs = parseExtraArgs(extraArgs);
        const body: Record<string, string | string[]> = {
          agent_type: session.agent_type,
          session_id: session.session_id,
        };
        if (name.trim()) body.name = name.trim();
        if (model.trim()) body.model = model.trim();
        if (session.agent_type === "codex" && reasoningEffort.trim()) {
          body.reasoning_effort = reasoningEffort.trim();
        }
        if (parsedExtraArgs.length > 0) {
          body.extra_args = parsedExtraArgs;
        }

        const res = await fetch(`${rtBaseUrl}/pty/resume`, {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }

        const result: { id: string; name: string } = await res.json();
        onSpawned(result);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [
      extraArgs,
      model,
      name,
      onOpenChange,
      onSpawned,
      reasoningEffort,
      rtBaseUrl,
      workdir,
      buildHeaders,
    ],
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-[520px] min-w-0 max-h-[calc(100vh-32px)] overflow-hidden rounded-2xl p-0 sm:max-w-[520px]">
        <DialogHeader className="min-w-0 px-6 pt-6">
          {dialogMode !== "route" ? (
            <button
              type="button"
              data-testid="pty-mode-back"
              onClick={() => changeDialogMode("route")}
              disabled={loading}
              className="mb-2 flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回模式选择
            </button>
          ) : null}
          <DialogTitle>
            {dialogMode === "create"
              ? "创建新终端"
              : dialogMode === "resume"
                ? "恢复已有终端"
                : "启动终端会话"}
          </DialogTitle>
          <DialogDescription>
            {dialogMode === "create"
              ? "启动新的 PTY 会话，并按创建模式填写连接参数"
              : dialogMode === "resume"
                ? "恢复 Claude / Codex 历史会话，并沿用历史会话自身路径"
                : "先选择创建新终端，或恢复已有终端"}
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="pty-spawn-dialog-body"
          className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-6 pb-6 pt-1"
        >
          {dialogMode === "route" ? (
            <div
              data-testid="pty-mode-route"
              className="grid min-w-0 gap-3 sm:grid-cols-2"
            >
              <button
                type="button"
                data-testid="pty-mode-create"
                onClick={() => changeDialogMode("create")}
                className="flex min-h-[132px] flex-col items-start justify-between rounded-2xl border border-border-card bg-card px-4 py-4 text-left transition-colors hover:bg-muted/40"
              >
                <div className="rounded-xl bg-[#F5F0ED] p-2 text-[#C75B3A]">
                  <Terminal className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">
                    创建新终端
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    新建一个 Claude、Codex 或自定义命令的 PTY 会话。
                  </p>
                </div>
              </button>

              <button
                type="button"
                data-testid="pty-mode-resume"
                onClick={() => changeDialogMode("resume")}
                className="flex min-h-[132px] flex-col items-start justify-between rounded-2xl border border-border-card bg-card px-4 py-4 text-left transition-colors hover:bg-muted/40"
              >
                <div className="rounded-xl bg-[#EEF6F5] p-2 text-[#0D9488]">
                  <Terminal className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">
                    恢复已有终端
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    从 Claude / Codex 历史会话恢复，沿用历史会话自身路径。
                  </p>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-4 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs font-medium text-muted-foreground">
                  Agent 类型（agent type）
                </label>
                <Select
                  value={agentType}
                  onValueChange={(value) => setAgentType(value as PtyAgentType)}
                  disabled={loading}
                >
                  <SelectTrigger
                    data-testid="pty-agent-type"
                    className="h-9 max-w-full min-w-0 rounded-lg text-sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    {dialogMode === "create" ? (
                      <SelectItem value="custom">Custom（自定义）</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="text-xs font-medium text-muted-foreground">
                  名称（可选）
                </label>
                <input
                  data-testid="pty-session-name"
                  type="text"
                  placeholder="my-terminal"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 w-full max-w-full min-w-0 rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
                  disabled={loading}
                />
              </div>

              {dialogMode === "create" ? (
                <div className="space-y-1.5 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground">
                    工作目录（可选）
                  </label>
                  <input
                    data-testid="pty-session-workdir"
                    type="text"
                    placeholder="D:\project\exomind"
                    value={workdir}
                    onChange={(e) => setWorkdir(e.target.value)}
                    className="h-9 w-full max-w-full min-w-0 rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
                    disabled={loading}
                  />
                </div>
              ) : (
                <div
                  data-testid="pty-resume-workdir-note"
                  className="rounded-xl border border-dashed border-border-card bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
                >
                  恢复已有终端时将沿用历史会话自身路径，无需重新填写工作目录。
                </div>
              )}

              {(agentType === "claude" || agentType === "codex") && (
                <div className="space-y-1.5 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground">
                    模型（model）
                  </label>
                  <input
                    data-testid="pty-model"
                    type="text"
                    placeholder={
                      agentType === "claude" ? "claude-sonnet-4-5" : "gpt-5.4"
                    }
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="h-9 w-full max-w-full min-w-0 rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
                    disabled={loading}
                  />
                </div>
              )}

              {agentType === "codex" && (
                <div className="space-y-1.5 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground">
                    推理强度（reasoning effort）
                  </label>
                  <Select
                    value={reasoningEffort}
                    onValueChange={(value) =>
                      setReasoningEffort(value as ReasoningEffort)
                    }
                    disabled={loading}
                  >
                    <SelectTrigger
                      data-testid="pty-reasoning-effort"
                      className="h-9 max-w-full min-w-0 rounded-lg text-sm"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                      <SelectItem value="xhigh">xhigh</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {dialogMode === "create" && agentType === "custom" && (
                <div className="space-y-1.5 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground">
                    命令（command）
                  </label>
                  <input
                    data-testid="pty-custom-command"
                    type="text"
                    placeholder="node"
                    value={customCommand}
                    onChange={(e) => setCustomCommand(e.target.value)}
                    className="h-9 w-full max-w-full min-w-0 rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
                    disabled={loading}
                  />
                </div>
              )}

              <div className="space-y-1.5 min-w-0">
                <label className="text-xs font-medium text-muted-foreground">
                  额外参数（extra args）
                </label>
                <input
                  data-testid="pty-extra-args"
                  type="text"
                  placeholder="--search --full-auto"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.target.value)}
                  className="h-9 w-full max-w-full min-w-0 rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
                  disabled={loading}
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              {dialogMode === "create" ? (
                <button
                  type="button"
                  data-testid="pty-spawn-submit"
                  onClick={handleSpawn}
                  disabled={
                    loading || (agentType === "custom" && !customCommand.trim())
                  }
                  className="w-full max-w-full min-w-0 rounded-[14px] bg-[#C75B3A] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[#B5502F] transition-colors"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      启动中...
                    </span>
                  ) : (
                    "启动新会话"
                  )}
                </button>
              ) : (
                <div className="space-y-2 min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">
                    恢复历史会话（resume history）
                  </div>
                  {historyLoading ? (
                    <div className="text-xs text-muted-foreground">
                      加载历史会话中...
                    </div>
                  ) : sessions.length > 0 ? (
                    <div
                      data-testid="pty-history-list"
                      className="max-h-[200px] min-w-0 space-y-1.5 overflow-x-hidden overflow-y-auto"
                    >
                      {sessions.map((session) =>
                        (() => {
                          const occupied = occupiedHistoricalSessionIdSet.has(
                            session.session_id,
                          );
                          const occupiedLabel =
                            occupiedHistoricalSessionLabels[
                              session.session_id
                            ]?.trim();
                          const sessionPrimaryLabel =
                            resolveHistoricalSessionPrimaryLabel(session);
                          const sessionPathLabel =
                            resolveHistoricalSessionPathLabel(session);
                          const sessionSecondaryTitle =
                            resolveHistoricalSessionSecondaryTitle(session);
                          const firstUserMessage =
                            resolveHistoricalSessionPreview(
                              session.first_user_message_preview ??
                                session.first_user_message,
                            );
                          const lastUserMessage = resolveHistoricalSessionPreview(
                            session.last_user_message_preview ??
                              session.last_user_message,
                          );
                          return (
                            <button
                              key={session.session_id}
                              data-testid={`pty-history-session-${session.session_id}`}
                              type="button"
                              onClick={() => handleResume(session)}
                              disabled={loading || occupied}
                              className="flex w-full max-w-full min-w-0 items-center gap-2.5 rounded-xl border border-border-card bg-card px-3 py-2 text-sm text-left hover:bg-muted/50 disabled:opacity-50 transition-colors"
                            >
                              <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="break-all font-medium">
                                  {sessionPrimaryLabel}
                                </div>
                                {sessionSecondaryTitle ? (
                                  <div className="break-words text-xs text-muted-foreground">
                                    会话名 · {sessionSecondaryTitle}
                                  </div>
                                ) : null}
                                {sessionPathLabel ? (
                                  <div className="break-all text-[11px] text-muted-foreground">
                                    目录 · {sessionPathLabel}
                                  </div>
                                ) : null}
                                {firstUserMessage ? (
                                  <div className="break-words text-[11px] text-muted-foreground">
                                    首句 · {firstUserMessage}
                                  </div>
                                ) : null}
                                {lastUserMessage ? (
                                  <div className="break-words text-[11px] text-muted-foreground">
                                    末句 · {lastUserMessage}
                                  </div>
                                ) : null}
                                <div className="text-xs text-muted-foreground">
                                  {formatRelativeTime(session.last_modified)}
                                </div>
                                {session.session_id ? (
                                  <div className="break-all text-[11px] text-muted-foreground">
                                    会话 ID · {session.session_id}
                                  </div>
                                ) : null}
                              </div>
                              {occupied ? (
                                <div
                                  data-testid={`pty-history-session-occupied-${session.session_id}`}
                                  className="min-w-0 max-w-[45%] break-words text-right text-[11px] text-amber-600"
                                >
                                  {occupiedLabel
                                    ? `已打开窗口 · ${occupiedLabel}`
                                    : "已打开窗口"}
                                </div>
                              ) : null}
                            </button>
                          );
                        })(),
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      当前没有可恢复的{" "}
                      {agentType === "claude" ? "Claude" : "Codex"} 会话
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
