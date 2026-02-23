import { ArrowLeft, CheckCheck, Clock3, MessageCircle, MoreHorizontal, Send, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentDetailData, AgentHubListItem } from '@/lib/types/agent-hub';

function getTargetIcon(target: AgentHubListItem) {
  if (target.id.includes('telegram')) return Send;
  if (target.id.includes('wechat')) return MessageCircle;
  return Sparkles;
}

export function AgentDetailPage({ agentId }: { agentId?: string }) {
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const targetId = agentId ?? '';

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!targetId) return;
      const response = await getAgentHubService().getAgentDetail(targetId);
      if (!disposed) {
        setDetail(response);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [targetId]);

  if (!detail) {
    return (
      <div data-testid="agent-detail-page" className="min-h-full px-5 py-4 text-sm text-[#A8A29E]">
        Agent 详情加载中...
      </div>
    );
  }

  return (
    <div data-testid="agent-detail-page" className="min-h-full bg-[#FAF7F5] px-5 py-3">
      <header data-testid="agent-detail-header" className="mb-3 flex items-center justify-between">
        <button
          type="button"
          data-testid="agent-detail-back-button"
          onClick={() => window.history.back()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C]"
          aria-label="返回（Back）"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-[17px] font-bold text-[#1C1917]">{detail.title}</h1>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C]"
          aria-label="更多（More）"
        >
          <MoreHorizontal size={16} />
        </button>
      </header>

      <section className="rounded-[18px] border border-[#E7E5E4] bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C75B3A20] text-[#C75B3A]">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-[16px] font-bold text-[#1C1917]">{detail.title}</p>
            <p className="text-xs text-[#22C55E]">● 运行中</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-[#78716C]">{detail.description}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {detail.stats.map((stat) => (
            <div key={stat.label} className="rounded-lg bg-[#FAF7F5] py-2 text-center">
              <span className="text-[11px] text-[#A8A29E]">{stat.label}</span>
              <p className="text-sm font-semibold text-[#1C1917]">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-[#78716C]">触发规则</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
          {detail.triggerRules.map((item, index) => (
            <div key={`${item.key}-${item.value}`}>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-[#78716C]">{item.key}</span>
                <span className={`text-sm ${item.highlight ? 'font-semibold text-[#C75B3A]' : 'text-[#1C1917]'}`}>
                  {item.value}
                </span>
              </div>
              {index !== detail.triggerRules.length - 1 && <div className="h-px bg-[#F5F0ED]" />}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-[#78716C]">输出目标</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
          {detail.targets.map((item, index) => {
            const Icon = getTargetIcon(item);
            return (
              <div key={item.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F5F0ED] text-[#78716C]">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1C1917]">{item.name}</p>
                    <p className="text-xs text-[#A8A29E]">{item.description}</p>
                  </div>
                </div>
                {index !== detail.targets.length - 1 && <div className="h-px bg-[#F5F0ED]" />}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-[#78716C]">最近执行</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
          {detail.recentLogs.map((item, index) => (
            <div key={item.id}>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 rounded-full bg-[#22C55E15] p-1 text-[#22C55E]">
                    <CheckCheck size={12} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1C1917]">{item.title}</p>
                    <p className="text-xs text-[#A8A29E]">{item.time}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-[#78716C]">
                  <Clock3 size={11} />
                  {item.duration ?? '--'}
                </div>
              </div>
              {index !== detail.recentLogs.length - 1 && <div className="h-px bg-[#F5F0ED]" />}
            </div>
          ))}
        </div>
      </section>

      <div className="pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4">
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
