import { BookOpen, FileText, History, RefreshCw, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { formatHostForUrl } from '@/config/runtime-target';
import { buildDirectRuntimeCandidates } from './agents-utils';

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

const WORKSPACE_REQUEST_TIMEOUT_MS = 3500;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timeout（请求超时）`));
    }, WORKSPACE_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

async function fetchWorkspaceKnowledgeList(agentId: string): Promise<KnowledgeListResponse | null> {
  try {
    if (isTauri() || (typeof window !== 'undefined' && '__TAURI__' in window)) {
      return await withTimeout(
        invoke<KnowledgeListResponse>('get_agent_workspace_knowledge_list', { agentId }),
        'get_agent_workspace_knowledge_list',
      );
    }
    return await httpGet<KnowledgeListResponse>(agentId, 'knowledge');
  } catch { return null; }
}

async function fetchWorkspaceKnowledgeFile(agentId: string, filename: string): Promise<string | null> {
  try {
    if (isTauri() || (typeof window !== 'undefined' && '__TAURI__' in window)) {
      return await withTimeout(
        invoke<string>('get_agent_workspace_knowledge', { agentId, filename }),
        'get_agent_workspace_knowledge',
      );
    }
    return await httpText(agentId, `knowledge/${filename}`);
  } catch { return null; }
}

async function fetchWorkspaceActions(agentId: string, limit = 50): Promise<ActionsResponse | null> {
  if (isTauri() || (typeof window !== 'undefined' && '__TAURI__' in window)) {
    try {
      const result = await withTimeout(
        invoke<ActionsResponse>('get_agent_workspace_actions', { agentId, limit }),
        'get_agent_workspace_actions',
      );
      if (result) return result;
    } catch {
      // Fall through to HTTP; release IPC must never keep the tab loading forever.
    }
  }

  try {
    return await httpGet<ActionsResponse>(agentId, `actions?limit=${limit}`);
  } catch {
    return null;
  }
}

async function fetchWorkspaceSoul(agentId: string): Promise<string | null> {
  try {
    if (isTauri() || (typeof window !== 'undefined' && '__TAURI__' in window)) {
      const result = await withTimeout(
        invoke<string>('get_agent_workspace_soul', { agentId }),
        'get_agent_workspace_soul',
      );
      if (result) return result;
      // Fallback: built-in agents don't have workspace — try Runtime API
      return await httpText(agentId, 'soul');
    }
    return await httpText(agentId, 'soul');
  } catch { return null; }
}

async function fetchWorkspaceStatus(agentId: string): Promise<WorkspaceStatus | null> {
  try {
    if (isTauri() || (typeof window !== 'undefined' && '__TAURI__' in window)) {
      return await withTimeout(
        invoke<WorkspaceStatus>('get_agent_workspace_status', { agentId }),
        'get_agent_workspace_status',
      );
    }
    return await httpGet<WorkspaceStatus>(agentId, 'status');
  } catch { return null; }
}

// HTTP fallback for non-Tauri (web) environments or built-in agents
async function httpGet<T>(agentId: string, path: string): Promise<T | null> {
  const hosts = await getRuntimeHostService().listHosts();
  const candidates = hosts.length > 0
    ? hosts
    : buildDirectRuntimeCandidates([]);
  for (const host of candidates) {
    try {
      const url = `http://${formatHostForUrl(host.host)}:${host.port}/agents/${encodeURIComponent(agentId)}/workspace/${path}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(WORKSPACE_REQUEST_TIMEOUT_MS) });
      if (resp.ok) return await resp.json() as T;
    } catch { /* try next candidate */ }
  }
  return null;
}

async function httpText(agentId: string, path: string): Promise<string | null> {
  const hosts = await getRuntimeHostService().listHosts();
  const candidates = hosts.length > 0
    ? hosts
    : buildDirectRuntimeCandidates([]);
  for (const host of candidates) {
    try {
      const url = `http://${formatHostForUrl(host.host)}:${host.port}/agents/${encodeURIComponent(agentId)}/workspace/${path}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(WORKSPACE_REQUEST_TIMEOUT_MS) });
      if (resp.ok) return await resp.text();
    } catch { /* try next candidate */ }
  }
  return null;
}

const STRATEGY_LABELS: Record<string, string> = {
  exploring: '探索',
  conserving: '保存',
  surviving: '求生',
  dying: '濒死',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  signal: '信号',
  thinking: '思考',
  text: '回复',
  tool_call: '工具调用',
  tool_result: '工具返回',
  knowledge_write: '记忆写入',
  knowledge_delete: '记忆删除',
};

function WorkspaceStateCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="rounded-xl border-border-card bg-card shadow-sm">
      <CardContent className="flex flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-sm font-semibold text-strong">{title}</p>
        <p className="text-xs leading-5 text-secondary">{description}</p>
      </CardContent>
    </Card>
  );
}

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

  if (loading) {
    return (
      <Card className="rounded-xl border-border-card bg-card shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="h-4 w-24 animate-pulse rounded-md bg-background" />
          <div className="h-20 animate-pulse rounded-xl border border-border-subtle bg-background" />
          <div className="h-11 animate-pulse rounded-lg border border-border-subtle bg-background" />
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <WorkspaceStateCard
        title="无法连接到 Runtime"
        description="暂时无法读取 workspace（工作区）数据，请检查 Runtime 主机或稍后刷新。"
      />
    );
  }

  const usagePercent = Math.round(data.usageRatio * 100);
  const usageKB = (data.usageBytes / 1024).toFixed(1);
  const maxKB = (data.maxBytes / 1024).toFixed(0);

  return (
    <div className="flex flex-col gap-3">
      <Card className="rounded-xl border-border-card bg-card shadow-sm">
        <CardHeader className="p-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-sm text-strong">知识库</CardTitle>
              <CardDescription className="text-xs text-secondary">已归档的记忆文件与空间占用概览。</CardDescription>
            </div>
            <Badge variant="outline" className="border-brand-accent/20 bg-brand-accent/10 text-[10px] text-brand-accent">
              {data.files.length} 文件
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>记忆使用量</span>
            <span>{usageKB} KB / {maxKB} KB ({usagePercent}%)</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-background ring-1 ring-border-subtle">
            <div
              className="h-full rounded-full bg-brand-accent transition-all duration-500"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {data.files.length === 0 ? (
        <WorkspaceStateCard
          title="知识库为空"
          description="Agent 还没有写入任何记忆文件，稍后产生内容后会显示在这里。"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border-card bg-card shadow-sm">
          {data.files.map((file, idx) => (
            <div key={file.name}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background"
                onClick={() => setSelectedFile(selectedFile === file.name ? null : file.name)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                  <FileText size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-strong">{file.name}</p>
                  <p className="text-[11px] text-secondary">Markdown / Text</p>
                </div>
                <Badge variant="outline" className="border-border-subtle bg-background text-[10px] text-secondary">
                  {(file.sizeBytes / 1024).toFixed(1)} KB
                </Badge>
              </button>
              {selectedFile === file.name && fileContent !== null && (
                <div className="border-t border-border-subtle bg-background px-4 py-3">
                  <pre className="exomind-selectable whitespace-pre-wrap text-xs leading-5 text-secondary">{fileContent}</pre>
                </div>
              )}
              {idx !== data.files.length - 1 && <div className="h-px bg-border-subtle" />}
            </div>
          ))}
        </Card>
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
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

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

  if (loading && actions.length === 0) {
    return (
      <Card className="rounded-xl border-border-card bg-card shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="h-4 w-24 animate-pulse rounded-md bg-background" />
          <div className="h-16 animate-pulse rounded-xl border border-border-subtle bg-background" />
          <div className="h-16 animate-pulse rounded-xl border border-border-subtle bg-background" />
        </CardContent>
      </Card>
    );
  }

  if (actions.length === 0) {
    return (
      <WorkspaceStateCard
        title="暂无行动记录"
        description="Agent 还没有产生 tick 行为，新的行动会按时间线方式显示在这里。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">最近 {actions.length} 条记录</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          className="h-8 rounded-lg px-2 text-xs text-secondary hover:bg-background hover:text-strong"
        >
          <RefreshCw size={11} />
          刷新
        </Button>
      </div>
      <Card className="overflow-hidden rounded-xl border-border-card bg-card shadow-sm">
        {[...actions].reverse().map((entry, idx) => {
          const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
          const typeLabel = ACTION_TYPE_LABELS[entry.actionType] ?? entry.actionType;
          const energyDelta = entry.energyAfter - entry.energyBefore;

          return (
            <div key={`${entry.tick}-${idx}`}>
              <div className="px-4 py-3">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 h-2 w-2 rounded-full bg-brand-accent" />
                    {idx !== actions.length - 1 && <span className="mt-1 h-full w-px bg-border-subtle" />}
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-background px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-border-subtle bg-card px-1.5 py-0.5 text-[10px] font-mono text-secondary">
                          #{entry.tick}
                        </span>
                        <span className="rounded-md border border-brand-accent/20 bg-brand-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-accent">
                          {typeLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-secondary">
                        <span>{time}</span>
                        {energyDelta !== 0 && (
                          <span className={energyDelta < 0 ? 'text-destructive' : 'text-success'}>
                            {energyDelta > 0 ? '+' : ''}{energyDelta}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-1">
                      {entry.description.length > 120 && !expanded.has(idx) ? (
                        <>
                          <p className="exomind-selectable whitespace-pre-wrap text-xs leading-5 text-secondary">
                            {entry.description.slice(0, 120)}...
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleExpand(idx)}
                            className="text-[10px] text-brand-accent hover:underline"
                          >
                            展开全文
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="exomind-selectable whitespace-pre-wrap text-xs leading-5 text-secondary">
                            {entry.description}
                          </p>
                          {entry.description.length > 120 && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(idx)}
                              className="text-[10px] text-brand-accent hover:underline"
                            >
                              收起
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {idx !== actions.length - 1 && <div className="h-px bg-border-subtle" />}
            </div>
          );
        })}
      </Card>
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

  if (loading) {
    return (
      <Card className="rounded-xl border-border-card bg-card shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="h-4 w-24 animate-pulse rounded-md bg-background" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-background" />
            <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-background" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {status && (
        <Card className="rounded-xl border-border-card bg-card shadow-sm">
          <CardHeader className="p-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-sm text-strong">身体状态</CardTitle>
                <CardDescription className="text-xs text-secondary">当前策略、运行计数与记忆使用情况。</CardDescription>
              </div>
              <Badge variant="outline" className="border-brand-accent/20 bg-brand-accent/10 text-[10px] text-brand-accent">
                {STRATEGY_LABELS[status.currentStrategy] ?? status.currentStrategy}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                <span className="text-[10px] text-secondary">策略</span>
                <p className="mt-1 text-sm font-semibold text-strong">
                  {STRATEGY_LABELS[status.currentStrategy] ?? status.currentStrategy}
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                <span className="text-[10px] text-secondary">运行 Tick</span>
                <p className="mt-1 text-sm font-semibold text-strong">{status.uptimeTicks}</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                <span className="text-[10px] text-secondary">总行动数</span>
                <p className="mt-1 text-sm font-semibold text-strong">{status.totalActions}</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                <span className="text-[10px] text-secondary">记忆使用率</span>
                <p className="mt-1 text-sm font-semibold text-strong">
                  {Math.round(status.knowledgeUsageRatio * 100)}%
                </p>
              </div>
            </div>
            {status.energyMax > 0 && (
              <div className="rounded-lg border border-border-subtle bg-background px-3 py-3">
                <div className="flex items-center justify-between gap-2 text-xs text-secondary">
                  <span>能量</span>
                  <span>
                    {status.energyLevel} / {status.energyMax} ({Math.round((status.energyLevel / status.energyMax) * 100)}%)
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-card ring-1 ring-border-subtle">
                  <div
                    className="h-full rounded-full bg-brand-accent transition-all duration-500"
                    style={{ width: `${Math.round((status.energyLevel / status.energyMax) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl border-border-card bg-card shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm text-strong">认知引擎</CardTitle>
          <CardDescription className="text-xs text-secondary">当前工作区绑定的认知执行内核。</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="rounded-lg border border-border-subtle bg-background px-3 py-3">
            <p className="text-sm font-medium text-strong">LlmCognition v1</p>
            <p className="mt-1 text-xs text-secondary">规则引擎 / Rule Engine（规则引擎）</p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border-card bg-card shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm text-strong">SOUL.md</CardTitle>
          <CardDescription className="text-xs text-secondary">身份 DNA（identity DNA，身份 DNA）与长期行为边界。</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {soul ? (
            <pre className="exomind-selectable rounded-lg border border-border-subtle bg-background px-3 py-3 whitespace-pre-wrap text-xs leading-6 text-secondary">
              {soul}
            </pre>
          ) : (
            <div className="rounded-lg border border-border-subtle bg-background px-3 py-4">
              <p className="text-xs text-secondary">无法加载 SOUL.md</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceTabs — exported composite
// ---------------------------------------------------------------------------

export function WorkspaceTabs({ agentId }: { agentId: string }) {
  return (
    <Tabs defaultValue="knowledge" className="mt-4 flex flex-col gap-3">
      <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border-card bg-card p-1 shadow-sm">
        <TabsTrigger value="knowledge" className="h-9 flex-1 gap-1.5 rounded-lg text-xs text-secondary hover:bg-background hover:text-strong data-[state=active]:bg-background data-[state=active]:text-strong">
          <BookOpen size={13} />
          知识库
        </TabsTrigger>
        <TabsTrigger value="actions" className="h-9 flex-1 gap-1.5 rounded-lg text-xs text-secondary hover:bg-background hover:text-strong data-[state=active]:bg-background data-[state=active]:text-strong">
          <History size={13} />
          行动日志
        </TabsTrigger>
        <TabsTrigger value="identity" className="h-9 flex-1 gap-1.5 rounded-lg text-xs text-secondary hover:bg-background hover:text-strong data-[state=active]:bg-background data-[state=active]:text-strong">
          <User size={13} />
          身份
        </TabsTrigger>
      </TabsList>

      <TabsContent value="knowledge" className="mt-0">
        <KnowledgeTab agentId={agentId} />
      </TabsContent>

      <TabsContent value="actions" className="mt-0">
        <ActionsTab agentId={agentId} />
      </TabsContent>

      <TabsContent value="identity" className="mt-0">
        <IdentityTab agentId={agentId} />
      </TabsContent>
    </Tabs>
  );
}
