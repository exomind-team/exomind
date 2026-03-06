import { AlarmClock, ArrowLeft, Clock3, MoreHorizontal, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentDetailData } from '@/lib/types/agent-hub';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

export function ActorDetailPage({ actorId }: { actorId?: string }) {
  const isDesktop = useIsDesktop();
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const targetId = actorId ?? '';

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
        const response = await getAgentHubService().getActorDetail(targetId);
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

  if (loading) {
    return (
      <div data-testid="actor-detail-page" className="min-h-full bg-surface px-5 py-4 text-sm text-muted-foreground md:px-8 lg:px-10">
        Actor 详情加载中...
      </div>
    );
  }

  if (!detail) {
    return (
      <div data-testid="actor-detail-page" className="min-h-full bg-surface px-5 py-3 text-foreground md:px-8 lg:px-10">
        <section
          data-testid="actor-detail-empty-state"
          className="mt-6 rounded-2xl border border-border-card bg-card px-4 py-6 text-center"
        >
          <p className="text-sm font-semibold text-foreground">未找到 Actor 详情</p>
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
    <div data-testid="actor-detail-page" className="min-h-full bg-surface px-5 py-3 text-foreground md:px-8 lg:px-10">
      <header data-testid="actor-detail-header" className="mb-3 flex items-center justify-between border-b border-border-card pb-3">
        <button
          type="button"
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#78716C20] text-[#78716C]">
            <AlarmClock size={18} />
          </div>
          <div>
            <p className="text-[16px] font-bold text-foreground">{detail.title}</p>
            <p className="text-xs text-[#22C55E]">● 运行中</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{detail.description}</p>
      </section>

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
        <h3 className="text-[13px] font-semibold text-muted-foreground">最近执行</h3>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border-card bg-card">
          {detail.recentLogs.map((item, index) => {
            const warning = item.status === 'warning';
            return (
              <div key={item.id}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 rounded-full p-1 ${warning ? 'bg-[#F973161A] text-[#F97316]' : 'bg-[#22C55E15] text-[#22C55E]'}`}>
                      <TriangleAlert size={12} />
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
            );
          })}
        </div>
      </section>
      <div className={isDesktop ? 'pb-6' : 'pb-[calc(env(safe-area-inset-bottom,0px)+20px)]'} />
    </div>
  );
}
