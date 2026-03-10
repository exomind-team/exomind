import { BookOpen, FileText, History, RefreshCw, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';

// ---------------------------------------------------------------------------
// Types — camelCase (matches Tauri command serde output)
// ---------------------------------------------------------------------------

interface KnowledgeFileInfo {
  name: string;
  sizeBytes: number;
}

interface KnowledgeListResponse {
  files: KnowledgeFileInfo[];
  usageBytes: number;
  maxBytes: number;
  usageRatio: number;
}

interface ActionEntry {
  timestamp: string;
  tick: number;
  actionType: string;
  description: string;
  energyBefore: number;
  energyAfter: number;
}

interface ActionsResponse {
  actions: ActionEntry[];
  total: number;
}

interface WorkspaceStatus {
  knowledgeUsageRatio: number;
  totalActions: number;
  uptimeTicks: number;
  currentStrategy: string;
  energyLevel: number;
  energyMax: number;
}

// ---------------------------------------------------------------------------
// Helpers — Tauri invoke (desktop) with HTTP fallback (web)
// ---------------------------------------------------------------------------

async function fetchWorkspaceKnowledgeList(agentId: string): Promise<KnowledgeListResponse | null> {
  try {
    console.log('[WorkspaceTabs] fetchKnowledgeList', { agentId, isTauri: isTauri() });
    if (isTauri()) {
      const result = await invoke<KnowledgeListResponse>('get_agent_workspace_knowledge_list', { agentId });
      console.log('[WorkspaceTabs] knowledge result:', result);
      return result;
    }
    return await httpGet<KnowledgeListResponse>(agentId, 'knowledge');
  } catch (e) { console.error('[WorkspaceTabs] knowledge error:', e); return null; }
}

async function fetchWorkspaceKnowledgeFile(agentId: string, filename: string): Promise<string | null> {
  try {
    if (isTauri()) {
      return await invoke<string>('get_agent_workspace_knowledge', { agentId, filename });
    }
    return await httpText(agentId, `knowledge/${filename}`);
  } catch { return null; }
}

async function fetchWorkspaceActions(agentId: string, limit = 50): Promise<ActionsResponse | null> {
  try {
    if (isTauri()) {
      return await invoke<ActionsResponse>('get_agent_workspace_actions', { agentId, limit });
    }
    return await httpGet<ActionsResponse>(agentId, `actions?limit=${limit}`);
  } catch { return null; }
}

async function fetchWorkspaceSoul(agentId: string): Promise<string | null> {
  try {
    if (isTauri()) {
      return await invoke<string>('get_agent_workspace_soul', { agentId });
    }
    return await httpText(agentId, 'soul');
  } catch { return null; }
}

async function fetchWorkspaceStatus(agentId: string): Promise<WorkspaceStatus | null> {
  try {
    if (isTauri()) {
      return await invoke<WorkspaceStatus>('get_agent_workspace_status', { agentId });
    }
    return await httpGet<WorkspaceStatus>(agentId, 'status');
  } catch { return null; }
}

// HTTP fallback for non-Tauri (web) environments
async function httpGet<T>(agentId: string, path: string): Promise<T | null> {
  const hosts = await getRuntimeHostService().listHosts();
  if (hosts.length === 0) return null;
  const host = hosts[0];
  const url = `http://${host.host}:${host.port}/agents/${encodeURIComponent(agentId)}/workspace/${path}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) return null;
  return await resp.json() as T;
}

async function httpText(agentId: string, path: string): Promise<string | null> {
  const hosts = await getRuntimeHostService().listHosts();
  if (hosts.length === 0) return null;
  const host = hosts[0];
  const url = `http://${host.host}:${host.port}/agents/${encodeURIComponent(agentId)}/workspace/${path}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) return null;
  return await resp.text();
}

const STRATEGY_LABELS: Record<string, string> = {
  exploring: '探索',
  conserving: '保存',
  surviving: '求生',
  dying: '濒死',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  think: '思考',
  signal: '信号',
  knowledge_write: '记忆写入',
  knowledge_delete: '记忆删除',
};

// ---------------------------------------------------------------------------
// KnowledgeTab
// ---------------------------------------------------------------------------

function KnowledgeTab({ agentId }: { agentId: string }) {
  const [data, setData] = useState<KnowledgeListResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchWorkspaceKnowledgeList(agentId);
    setData(result);
    setLoading(false);
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedFile) { setFileContent(null); return; }
    let cancelled = false;
    void (async () => {
      const content = await fetchWorkspaceKnowledgeFile(agentId, selectedFile);
      if (!cancelled) setFileContent(content);
    })();
    return () => { cancelled = true; };
  }, [agentId, selectedFile]);

  if (loading) return <div className="py-4 text-center text-xs text-muted-foreground">加载中...</div>;
  if (!data) return <div className="py-4 text-center text-xs text-muted-foreground">无法连接到 Runtime</div>;

  const usagePercent = Math.round(data.usageRatio * 100);
  const usageKB = (data.usageBytes / 1024).toFixed(1);
  const maxKB = (data.maxBytes / 1024).toFixed(0);

  return (
    <div>
      {/* Usage bar */}
      <div className="mb-3 rounded-xl border border-border-card bg-card p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>记忆使用量</span>
          <span>{usageKB} KB / {maxKB} KB ({usagePercent}%)</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[#3B82F6] transition-all duration-500"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {/* File list */}
      {data.files.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">知识库为空 — Agent 尚未记录任何记忆</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-card bg-card">
          {data.files.map((file, idx) => (
            <div key={file.name}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50"
                onClick={() => setSelectedFile(selectedFile === file.name ? null : file.name)}
              >
                <FileText size={14} className="shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{file.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{(file.sizeBytes / 1024).toFixed(1)} KB</span>
              </button>
              {selectedFile === file.name && fileContent !== null && (
                <div className="border-t border-border bg-background px-4 py-3">
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{fileContent}</pre>
                </div>
              )}
              {idx !== data.files.length - 1 && <div className="h-px bg-border" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionsTab
// ---------------------------------------------------------------------------

function ActionsTab({ agentId }: { agentId: string }) {
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchWorkspaceActions(agentId, 50);
    setActions(result?.actions ?? []);
    setLoading(false);
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (loading && actions.length === 0) return <div className="py-4 text-center text-xs text-muted-foreground">加载中...</div>;

  if (actions.length === 0) {
    return <div className="py-6 text-center text-xs text-muted-foreground">暂无行动记录 — Agent 尚未执行任何 tick</div>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">最近 {actions.length} 条记录</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <RefreshCw size={11} />
          刷新
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border-card bg-card">
        {[...actions].reverse().map((entry, idx) => {
          const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
          const typeLabel = ACTION_TYPE_LABELS[entry.actionType] ?? entry.actionType;
          const energyDelta = entry.energyAfter - entry.energyBefore;

          return (
            <div key={`${entry.tick}-${idx}`}>
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      #{entry.tick}
                    </span>
                    <span className="rounded-md bg-[#3B82F615] px-1.5 py-0.5 text-[10px] font-medium text-[#3B82F6]">
                      {typeLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{time}</span>
                    {energyDelta !== 0 && (
                      <span className={energyDelta < 0 ? 'text-[#EF4444]' : 'text-[#22C55E]'}>
                        {energyDelta > 0 ? '+' : ''}{energyDelta}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
              </div>
              {idx !== actions.length - 1 && <div className="h-px bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdentityTab
// ---------------------------------------------------------------------------

function IdentityTab({ agentId }: { agentId: string }) {
  const [soul, setSoul] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [soulContent, statusData] = await Promise.all([
        fetchWorkspaceSoul(agentId),
        fetchWorkspaceStatus(agentId),
      ]);
      if (!cancelled) {
        setSoul(soulContent);
        setStatus(statusData);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  if (loading) return <div className="py-4 text-center text-xs text-muted-foreground">加载中...</div>;

  return (
    <div>
      {/* Body status */}
      {status && (
        <div className="mb-3 rounded-xl border border-border-card bg-card p-4">
          <h4 className="mb-2 text-xs font-semibold text-muted-foreground">身体状态</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">策略</span>
              <p className="text-sm font-semibold text-foreground">
                {STRATEGY_LABELS[status.currentStrategy] ?? status.currentStrategy}
              </p>
            </div>
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">运行 Tick</span>
              <p className="text-sm font-semibold text-foreground">{status.uptimeTicks}</p>
            </div>
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">总行动数</span>
              <p className="text-sm font-semibold text-foreground">{status.totalActions}</p>
            </div>
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">记忆使用率</span>
              <p className="text-sm font-semibold text-foreground">
                {Math.round(status.knowledgeUsageRatio * 100)}%
              </p>
            </div>
          </div>
          {status.energyMax > 0 && (
            <div className="mt-2 rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">能量</span>
              <p className="text-sm font-semibold text-foreground">
                {status.energyLevel} / {status.energyMax} ({Math.round((status.energyLevel / status.energyMax) * 100)}%)
              </p>
            </div>
          )}
        </div>
      )}

      {/* Cognition engine */}
      <div className="mb-3 rounded-xl border border-border-card bg-card p-4">
        <h4 className="mb-1 text-xs font-semibold text-muted-foreground">认知引擎</h4>
        <p className="text-sm text-foreground">LlmCognition v1 (规则引擎)</p>
      </div>

      {/* SOUL.md */}
      <div className="rounded-xl border border-border-card bg-card p-4">
        <h4 className="mb-2 text-xs font-semibold text-muted-foreground">SOUL.md — 身份 DNA</h4>
        {soul ? (
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{soul}</pre>
        ) : (
          <p className="text-xs text-muted-foreground">无法加载 SOUL.md</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceTabs — exported composite
// ---------------------------------------------------------------------------

export function WorkspaceTabs({ agentId }: { agentId: string }) {
  return (
    <Tabs defaultValue="knowledge" className="mt-4">
      <TabsList className="w-full">
        <TabsTrigger value="knowledge" className="flex-1 gap-1">
          <BookOpen size={13} />
          知识库
        </TabsTrigger>
        <TabsTrigger value="actions" className="flex-1 gap-1">
          <History size={13} />
          行动日志
        </TabsTrigger>
        <TabsTrigger value="identity" className="flex-1 gap-1">
          <User size={13} />
          身份
        </TabsTrigger>
      </TabsList>

      <TabsContent value="knowledge">
        <KnowledgeTab agentId={agentId} />
      </TabsContent>

      <TabsContent value="actions">
        <ActionsTab agentId={agentId} />
      </TabsContent>

      <TabsContent value="identity">
        <IdentityTab agentId={agentId} />
      </TabsContent>
    </Tabs>
  );
}
