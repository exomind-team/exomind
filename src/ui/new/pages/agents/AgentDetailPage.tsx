import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentDetailData } from '@/lib/types/agent-hub';

export function AgentDetailPage({ agentId }: { agentId?: string }) {
  const [detail, setDetail] = useState<AgentDetailData | null>(null);

  useEffect(() => {
    let disposed = false;
    const targetId = agentId ?? '';
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
  }, [agentId]);

  if (!detail) {
    return (
      <div data-testid="agent-detail-page" className="min-h-full px-5 py-4 text-sm text-[#A8A29E]">
        Agent 详情加载中...
      </div>
    );
  }

  return (
    <div data-testid="agent-detail-page" className="min-h-full bg-[#FAF7F5] px-5 py-4">
      <section className="rounded-[18px] border border-[#E7E5E4] bg-white p-4">
        <p className="text-[18px] font-bold text-[#1C1917]">{detail.title}</p>
        <p className="mt-2 text-sm text-[#78716C]">{detail.description}</p>
        <div className="mt-3 flex justify-between gap-2">
          {detail.stats.map((stat) => (
            <div key={stat.label} className="flex flex-1 flex-col items-center rounded-lg bg-[#FAF7F5] py-2">
              <span className="text-[11px] text-[#A8A29E]">{stat.label}</span>
              <span className="text-sm font-semibold text-[#1C1917]">{stat.value}</span>
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
          {detail.targets.map((item, index) => (
            <div key={item.id}>
              <div className="px-4 py-3">
                <p className="text-sm font-medium text-[#1C1917]">{item.name}</p>
                <p className="text-xs text-[#A8A29E]">{item.description}</p>
              </div>
              {index !== detail.targets.length - 1 && <div className="h-px bg-[#F5F0ED]" />}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold text-[#78716C]">最近执行</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
          {detail.recentLogs.map((item, index) => (
            <div key={item.id}>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#1C1917]">{item.title}</p>
                  <p className="text-xs text-[#A8A29E]">{item.time}</p>
                </div>
                <span className="text-xs text-[#78716C]">{item.duration ?? '--'}</span>
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
          className="w-full rounded-[14px] bg-[#C75B3A] px-4 py-3 text-sm font-semibold text-white"
        >
          与 Agent 对话
        </button>
      </div>
    </div>
  );
}

