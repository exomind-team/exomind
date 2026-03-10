import { ArrowLeft, CheckCheck, Clock3, Heart, MessageCircle, MoreHorizontal, Send, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentDetailData, AgentEnergySnapshot, AgentHubListItem } from '@/lib/types/agent-hub';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { WorkspaceTabs } from './WorkspaceTabs';

const PHASE_LABELS: Record<string, string> = {
  normal: '正常',
  slowing: '降频中',
  critical: '能量不足',
  dying: '濒死',
  dormant: '休眠',
};

const PHASE_COLORS: Record<string, string> = {
  normal: '#22C55E',
  slowing: '#EAB308',
  critical: '#F97316',
  dying: '#EF4444',
  dormant: '#6B7280',
};

function EnergyBar({ energy }: { energy: AgentEnergySnapshot }) {
  const percent = Math.round(energy.ratio * 100);
  const color = PHASE_COLORS[energy.phase] ?? '#6B7280';
  const label = PHASE_LABELS[energy.phase] ?? energy.phase;

  return (
    <section className="mt-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        <Heart size={12} />
        生命能量 (C1)
      </h3>
      <div className="mt-2 rounded-2xl border border-border-card bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {energy.current} / {energy.max}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ color, backgroundColor: `${color}15` }}
          >
            {label}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${percent}%`, backgroundColor: color }}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-background py-1.5">
            <span className="text-[11px] text-muted-foreground">每 tick 消耗</span>
            <p className="text-sm font-semibold text-foreground">{energy.tick_cost}</p>
          </div>
          <div className="rounded-lg bg-background py-1.5">
            <span className="text-[11px] text-muted-foreground">剩余能量</span>
            <p className="text-sm font-semibold text-foreground">{percent}%</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function getTargetIcon(target: AgentHubListItem) {
  if (target.id.includes('telegram')) return Send;
  if (target.id.includes('wechat')) return MessageCircle;
  return Sparkles;
}

export function AgentDetailPage({ agentId }: { agentId?: string }) {
  const isDesktop = useIsDesktop();
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [energy, setEnergy] = useState<AgentEnergySnapshot | null>(null);
  const targetId = agentId ?? '';

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!targetId) {
        if (!disposed) {
          setDetail(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const response = await getAgentHubService().getAgentDetail(targetId);
        if (!disposed) {
          setDetail(response);
        }
      } catch {
        if (!disposed) {
          setDetail(null);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [targetId]);

  // Energy polling (2s interval)
  useEffect(() => {
    if (!targetId) return;
    let disposed = false;

    const poll = async () => {
      try {
        const hosts = await getRuntimeHostService().listHosts();
        if (hosts.length === 0 || disposed) return;
        const host = hosts[0];
        const url = `http://${host.host}:${host.port}/agents/${encodeURIComponent(targetId)}/energy`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!resp.ok || disposed) return;
        const snap: AgentEnergySnapshot = await resp.json();
        if (!disposed) setEnergy(snap);
      } catch {
        // ignore polling errors
      }
    };

    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [targetId]);

  if (loading) {
    return (
      <div data-testid="agent-detail-page" className="min-h-full bg-surface px-5 py-4 text-sm text-muted-foreground md:px-8 lg:px-10">
        Agent 详情加载中...
      </div>
    );
  }

  if (!detail) {
    return (
      <div data-testid="agent-detail-page" className="min-h-full bg-surface px-5 py-3 text-foreground md:px-8 lg:px-10">
        <section
          data-testid="agent-detail-empty-state"
          className="mt-6 rounded-2xl border border-border-card bg-card px-4 py-6 text-center"
        >
          <p className="text-sm font-semibold text-foreground">未找到 Agent 详情</p>
          <p className="mt-1 text-xs text-muted-foreground">该节点可能已删除或尚未配置详情数据。</p>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground"
          >
            返回上一页
          </button>
        </section>
      </div>
    );
  }

  return (
    <div data-testid="agent-detail-page" className="min-h-full bg-surface px-5 py-3 text-foreground md:px-8 lg:px-10">
      <header data-testid="agent-detail-header" className="mb-3 flex items-center justify-between border-b border-border-card pb-3">
        <button
          type="button"
          data-testid="agent-detail-back-button"
          onClick={() => window.history.back()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label="返回（Back）"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-[17px] font-bold text-foreground">{detail.title}</h1>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label="更多（More）"
        >
          <MoreHorizontal size={16} />
        </button>
      </header>

      <section className="rounded-[18px] border border-border-card bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C75B3A20] text-[#C75B3A]">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-[16px] font-bold text-foreground">{detail.title}</p>
            <p className="text-xs text-[#22C55E]">● 运行中</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{detail.description}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {detail.stats.map((stat) => (
            <div key={stat.label} className="rounded-lg bg-background py-2 text-center">
              <span className="text-[11px] text-muted-foreground">{stat.label}</span>
              <p className="text-sm font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      {energy && <EnergyBar energy={energy} />}

      {/* Workspace tabs — shown for life agents (those with workspace) */}
      <WorkspaceTabs agentId={targetId} />

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-muted-foreground">触发规则</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border-card bg-card">
          {detail.triggerRules.map((item, index) => (
            <div key={`${item.key}-${item.value}`}>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">{item.key}</span>
                <span className={`text-sm ${item.highlight ? 'font-semibold text-[#C75B3A]' : 'text-foreground'}`}>
                  {item.value}
                </span>
              </div>
              {index !== detail.triggerRules.length - 1 && <div className="h-px bg-border" />}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-muted-foreground">输出目标</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border-card bg-card">
          {detail.targets.map((item, index) => {
            const Icon = getTargetIcon(item);
            return (
              <div key={item.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                {index !== detail.targets.length - 1 && <div className="h-px bg-border" />}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-muted-foreground">最近执行</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border-card bg-card">
          {detail.recentLogs.map((item, index) => (
            <div key={item.id}>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 rounded-full bg-[#22C55E15] p-1 text-[#22C55E]">
                    <CheckCheck size={12} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.time}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 size={11} />
                  {item.duration ?? '--'}
                </div>
              </div>
              {index !== detail.recentLogs.length - 1 && <div className="h-px bg-border" />}
            </div>
          ))}
        </div>
      </section>

      <div className={`pt-4 ${isDesktop ? 'pb-6' : 'pb-[calc(env(safe-area-inset-bottom,0px)+20px)]'}`}>
        <button
          type="button"
          data-testid="agent-detail-chat-button"
          onClick={() => {
            if (!targetId) return;
            window.location.href = `/agents/chat/${targetId}`;
          }}
          className="w-full rounded-[14px] bg-[#C75B3A] px-4 py-3 text-sm font-semibold text-white"
        >
          与 Agent 对话
        </button>
      </div>
    </div>
  );
}
