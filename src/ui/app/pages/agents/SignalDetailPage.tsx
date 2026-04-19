import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { SignalEvent, SignalRoute } from '@/lib/types/signal-pool';
import type { SignalGraphNode } from '@/ui/app/pages/agents-signal-topology';
import { buildSignalGraph } from '@/ui/app/pages/agents-signal-topology';
import type { RuntimeAggregatedAgent } from '@/services/runtime-manager';
import {
  formatSignalPayload,
  formatSignalTime,
  signalNodeTypeBadgeLabel,
  signalTopicTint,
} from '@/ui/app/pages/agents/agents-utils';
import { getSelectedRuntimeTarget, formatHostForUrl } from '@/config/runtime-target';

function SignalDetailHeader() {
  return (
    <header data-testid="signal-detail-header" className="mb-4">
      <div className="inline-flex select-none items-center gap-2 text-xs text-muted-foreground">
        <Link to="/agents" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft size={14} />
          网络
        </Link>
        <span>/</span>
        <span>信号详情</span>
      </div>
    </header>
  );
}

function SignalDetailLoadingState({ signalId }: { signalId: string }) {
  return (
    <section data-testid="signal-detail-loading" aria-live="polite" className="flex flex-col gap-4 text-foreground">
      <p className="text-sm text-muted-foreground">加载中...</p>

      <div className="rounded-2xl border border-border-card bg-card p-4 animate-pulse">
        <div className="flex flex-col gap-1">
          <div className="h-3 w-14 rounded-full bg-muted" aria-hidden="true" />
          <p className="font-mono text-sm text-foreground">{signalId || '—'}</p>
        </div>
      </div>

      {Array.from({ length: 2 }).map((_, index) => (
        <div key={`signal-loading-card-${index}`} className="rounded-2xl border border-border-card bg-card p-4 animate-pulse">
          <div className="h-3 w-16 rounded-full bg-muted" aria-hidden="true" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((__, statIndex) => (
              <div key={`signal-loading-stat-${index}-${statIndex}`} className="space-y-2">
                <div className="h-3 w-12 rounded-full bg-muted" aria-hidden="true" />
                <div className="h-4 w-20 rounded-full bg-muted" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-border-card bg-card p-4 animate-pulse">
        <div className="h-3 w-20 rounded-full bg-muted" aria-hidden="true" />
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`signal-loading-route-${index}`} className="rounded-[6px] border border-border-card bg-background px-3 py-2">
              <div className="h-4 w-full rounded-full bg-muted" aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SignalDetailPage() {
  const { signalId } = useParams({ strict: false }) as { signalId?: string };
  const [signalRoutes, setSignalRoutes] = useState<SignalRoute[]>([]);
  const [signalHistory, setSignalHistory] = useState<SignalEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const nodeId = signalId ?? '';

  // Build graph from routes only (no agent data needed for signal detail)
  const signalGraph = useMemo(
    () => buildSignalGraph(signalRoutes, [] as RuntimeAggregatedAgent[]),
    [signalRoutes],
  );

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const target = getSelectedRuntimeTarget();
        const baseUrl = `http://${formatHostForUrl(target.host)}:${target.port}`;

        const [routesResponse, historyResponse] = await Promise.all([
          fetch(`${baseUrl}/signal-routes`).then((r) => r.ok ? r.json() as Promise<SignalRoute[]> : []),
          fetch(`${baseUrl}/signals/history`).then((r) => r.ok ? r.json() as Promise<SignalEvent[]> : []),
        ]);
        const routes = routesResponse as SignalRoute[];

        if (!disposed) {
          setSignalRoutes(routes);
          setSignalHistory(historyResponse as SignalEvent[]);
          setIsLoading(false);
        }
      } catch {
        if (!disposed) setIsLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, []);

  const historyEvent = signalHistory.find((e) => e.id === nodeId);
  const normalizedNodeId = nodeId.includes(':') ? nodeId.split(':').slice(1).join(':') : nodeId;
  const routeMatchKey = historyEvent?.topic ?? normalizedNodeId ?? nodeId;
  const node: SignalGraphNode | undefined =
    signalGraph.nodes.find((n) => n.id === nodeId) ??
    signalGraph.nodes.find((n) => n.label === normalizedNodeId || n.id.endsWith(`:${normalizedNodeId}`));
  const relatedRoutes = routeMatchKey
    ? signalRoutes.filter((r) => r.target_ref === routeMatchKey || r.topic.includes(routeMatchKey))
    : [];
  const incomingCount = routeMatchKey ? signalRoutes.filter((r) => r.target_ref === routeMatchKey).length : 0;
  const outgoingCount = routeMatchKey ? signalRoutes.filter((r) => r.topic.includes(routeMatchKey)).length : 0;

  return (
    <div className="min-h-full bg-surface px-5 py-4 md:px-8" data-testid="signal-detail-page">
      <SignalDetailHeader />

      {isLoading ? <SignalDetailLoadingState signalId={nodeId} /> : (
        <div className="flex flex-col gap-4 text-foreground">
          <div className="rounded-2xl border border-border-card bg-card p-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">
                {historyEvent ? '信号 ID' : '节点 ID'}
              </p>
              <p className="font-mono text-sm text-foreground">{nodeId || '—'}</p>
            </div>
          </div>

          {historyEvent && (
            <div className="rounded-2xl border border-border-card bg-card p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: signalTopicTint(historyEvent.topic) }}
                  />
                  <p className="font-mono text-xs text-foreground">{historyEvent.topic}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">来源</p>
                    <p className="text-xs text-foreground">{historyEvent.source}</p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">时间</p>
                    <p className="text-xs text-foreground">{formatSignalTime(historyEvent.ts)}</p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">主机</p>
                    <p className="text-xs text-foreground">{historyEvent.origin_host_id}</p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">跳数</p>
                    <p className="text-xs text-foreground">{historyEvent.hop}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] text-muted-foreground">Payload</p>
                  <pre className="overflow-x-auto rounded-lg bg-background p-3 text-[10px] text-foreground">
                    {formatSignalPayload(historyEvent.payload)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {node && (
            <div className="rounded-2xl border border-border-card bg-card p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      node.type === 'signal-input'
                        ? 'bg-[#EDE9FE] text-[#7C3AED]'
                        : node.type === 'agent'
                          ? 'bg-[#CCFBF1] text-[#0D9488]'
                          : node.type === 'actor'
                            ? 'bg-[#FEF3C7] text-[#B45309]'
                            : node.type === 'topic'
                              ? 'bg-[#FFEDD5] text-[#EA580C]'
                              : 'bg-[#DBEAFE] text-[#1D4ED8]'
                    }`}
                  >
                    {signalNodeTypeBadgeLabel(node.type)}
                  </span>
                  <span className="text-xs text-muted-foreground">状态：{node.status}</span>
                </div>
                <div className="flex gap-4">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">接收路由</p>
                    <p className="text-sm font-medium text-foreground">{incomingCount}</p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">发送路由</p>
                    <p className="text-sm font-medium text-foreground">{outgoingCount}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border-card bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">最近信号路由</p>
            <div className="mt-2 flex flex-col gap-1">
              {relatedRoutes.slice(0, 10).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-[6px] border border-border-card bg-background px-3 py-2"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${r.enabled ? 'bg-[#22C55E]' : 'bg-[#57534E]'}`} />
                  <span className="flex-1 truncate font-mono text-xs text-foreground">{r.topic}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">→ {r.target_type}</span>
                </div>
              ))}
              {relatedRoutes.length === 0 && (
                <p className="text-xs text-muted-foreground">无关联路由</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
