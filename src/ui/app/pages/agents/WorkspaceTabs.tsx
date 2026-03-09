import { BookOpen, FileText, History, RefreshCw, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';

// ---------------------------------------------------------------------------
// Types matching REST API responses
// ---------------------------------------------------------------------------

interface KnowledgeListResponse {
  files: string[];
  usage_bytes: number;
  max_bytes: number;
  usage_ratio: number;
}

interface ActionEntry {
  timestamp: string;
  tick: number;
  action_type: string;
  description: string;
  energy_before: number;
  energy_after: number;
}

interface WorkspaceStatus {
  knowledge_usage_ratio: number;
  total_actions: number;
  uptime_ticks: number;
  current_strategy: string;
  energy_current: number | null;
  energy_max: number | null;
  energy_ratio: number | null;
  energy_phase: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWorkspaceApi<T>(agentId: string, path: string): Promise<T | null> {
  try {
    const hosts = await getRuntimeHostService().listHosts();
    if (hosts.length === 0) return null;
    const host = hosts[0];
    const url = `http://${host.host}:${host.port}/agents/${encodeURIComponent(agentId)}/workspace/${path}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return null;
    return await resp.json() as T;
  } catch {
    return null;
  }
}

async function fetchWorkspaceText(agentId: string, path: string): Promise<string | null> {
  try {
    const hosts = await getRuntimeHostService().listHosts();
    if (hosts.length === 0) return null;
    const host = hosts[0];
    const url = `http://${host.host}:${host.port}/agents/${encodeURIComponent(agentId)}/workspace/${path}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
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
    const result = await fetchWorkspaceApi<KnowledgeListResponse>(agentId, 'knowledge');
    setData(result);
    setLoading(false);
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedFile) { setFileContent(null); return; }
    let cancelled = false;
    void (async () => {
      const content = await fetchWorkspaceText(agentId, `knowledge/${selectedFile}`);
      if (!cancelled) setFileContent(content);
    })();
    return () => { cancelled = true; };
  }, [agentId, selectedFile]);

  if (loading) return <div className="py-4 text-center text-xs text-muted-foreground">加载中...</div>;
  if (!data) return <div className="py-4 text-center text-xs text-muted-foreground">无法连接到 Runtime</div>;

  const usagePercent = Math.round(data.usage_ratio * 100);
  const usageKB = (data.usage_bytes / 1024).toFixed(1);
  const maxKB = (data.max_bytes / 1024).toFixed(0);

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
          {data.files.map((filename, idx) => (
            <div key={filename}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50"
                onClick={() => setSelectedFile(selectedFile === filename ? null : filename)}
              >
                <FileText size={14} className="shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{filename}</span>
              </button>
              {selectedFile === filename && fileContent !== null && (
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
    const result = await fetchWorkspaceApi<ActionEntry[]>(agentId, 'actions?limit=50');
    setActions(result ?? []);
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
          const typeLabel = ACTION_TYPE_LABELS[entry.action_type] ?? entry.action_type;
          const energyDelta = entry.energy_after - entry.energy_before;

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
        fetchWorkspaceText(agentId, 'soul'),
        fetchWorkspaceApi<WorkspaceStatus>(agentId, 'status'),
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
                {STRATEGY_LABELS[status.current_strategy] ?? status.current_strategy}
              </p>
            </div>
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">运行 Tick</span>
              <p className="text-sm font-semibold text-foreground">{status.uptime_ticks}</p>
            </div>
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">总行动数</span>
              <p className="text-sm font-semibold text-foreground">{status.total_actions}</p>
            </div>
            <div className="rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">记忆使用率</span>
              <p className="text-sm font-semibold text-foreground">
                {Math.round(status.knowledge_usage_ratio * 100)}%
              </p>
            </div>
          </div>
          {status.energy_ratio !== null && (
            <div className="mt-2 rounded-lg bg-background py-2 text-center">
              <span className="text-[10px] text-muted-foreground">能量</span>
              <p className="text-sm font-semibold text-foreground">
                {status.energy_current} / {status.energy_max} ({Math.round((status.energy_ratio ?? 0) * 100)}%)
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
