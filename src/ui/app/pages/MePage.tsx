import {
  Activity,
  BookOpenText,
  BrainCircuit,
  CircleDot,
  Flame,
  Network,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { getMeService } from '@/lib/services';
import { PageShell } from '@/ui/app/components/PageShell';
import { PageTabs } from '@/ui/app/components/PageTabs';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import type {
  MeBehaviorPattern,
  MeDashboardData,
  MeHabitLoop,
  MeLearningItem,
  MePatternHistoryItem,
  MeStatusMetric,
  MeViewType,
} from '@/lib/types/me';

function metricToneClass(metric: MeStatusMetric): string {
  if (metric.tone === 'green') return 'bg-[#F0FDF4] dark:bg-[#1E2B22]';
  if (metric.tone === 'blue') return 'bg-[#EFF6FF] dark:bg-[#1D2837]';
  if (metric.tone === 'amber') return 'bg-[#FFFBEB] dark:bg-[#302818]';
  if (metric.tone === 'rose') return 'bg-[#FEF2F2] dark:bg-[#352122]';
  return 'bg-[#FEF7F5] dark:bg-[#2E2420]';
}

function behaviorStateClass(pattern: MeBehaviorPattern): string {
  if (pattern.state === 'good') return 'bg-[#F0FDF4] text-[#16A34A] dark:bg-[#1F2F25] dark:text-[#86EFAC]';
  if (pattern.state === 'risk') return 'bg-[#FEF2F2] text-[#DC2626] dark:bg-[#3A2323] dark:text-[#FCA5A5]';
  return 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#3A2A22] dark:text-[#FDBA74]';
}

function historyDeltaClass(item: MePatternHistoryItem): string {
  if (item.deltaTone === 'down') return 'text-[#16A34A]';
  if (item.deltaTone === 'up') return 'text-[#DC2626]';
  return 'text-[#A8A29E]';
}

function learnItemToneClass(item: MeLearningItem): string {
  if (item.tone === 'blue') return 'bg-[#EFF6FF] dark:bg-[#1D2837]';
  if (item.tone === 'purple') return 'bg-[#F5F3FF] dark:bg-[#2B233A]';
  return 'bg-[#FEF7F5] dark:bg-[#2E2420]';
}

function habitLoopToneClass(loop: MeHabitLoop): string {
  if (loop.state === 'good') return 'bg-[#F0FDF4] dark:bg-[#1E2B22]';
  if (loop.state === 'risk') return 'bg-[#FEF2F2] dark:bg-[#3A2323]';
  return 'bg-[#EFF6FF] dark:bg-[#1D2837]';
}

export function MePage() {
  const isDesktop = useIsDesktop();
  const [activeTab, setActiveTab] = useState<MeViewType>('status');
  const [data, setData] = useState<MeDashboardData | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const dashboard = await getMeService().getDashboardData();
      if (!disposed) {
        setData(dashboard);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  if (!data) {
    return (
      <div className="min-h-full bg-page px-6 py-6 text-sm text-muted dark:bg-page-dark md:px-8 lg:px-10" data-testid="new-me-page">
        Me 数据加载中...
      </div>
    );
  }

  return (
    <PageShell
      title="Me"
      className="min-h-full"
      contentClassName={isDesktop ? 'px-5 pb-8 pt-3 md:px-8 lg:px-10' : 'px-5 pb-[calc(env(safe-area-inset-bottom,0px)+92px)] pt-3 md:px-8 lg:px-10'}
    >
      <div data-testid="new-me-page" className="min-h-0 flex h-full flex-col">
        <PageTabs
          activeTab={activeTab}
          onTabChange={(nextTab) => setActiveTab(nextTab as MeViewType)}
          tabs={[
            { id: 'status', label: '状态' },
            { id: 'learn', label: '学习' },
            { id: 'implicit', label: '内隐' },
          ]}
          className="min-h-0 flex-1"
        >
          <div data-tab-id="status" className={`space-y-4 ${isDesktop ? '' : ''}`}>
            <section
              className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-status-summary-card"
            >
              <div className="flex items-center gap-2 text-[#1C1917] dark:text-[#FAFAF9]">
                <Activity size={16} className="text-[#C75B3A]" />
                <span className="text-sm font-semibold">{data.status.summaryTitle}</span>
                <span className="ml-auto text-xs text-[#A8A29E]">{data.status.updatedAtLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {data.status.metrics.map((metric) => (
                  <article key={metric.id} className={`rounded-xl p-3 ${metricToneClass(metric)}`}>
                    <p className="text-[11px] text-[#78716C] dark:text-[#CFC5BE]">{metric.title}</p>
                    <p className="text-[15px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
                    <p className="text-[11px] text-[#A8A29E] dark:text-[#B8B1AC]">{metric.hint}</p>
                  </article>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {data.status.financeMetrics.map((metric) => (
                  <article key={metric.id} className={`rounded-xl p-3 ${metricToneClass(metric)}`}>
                    <p className="text-[11px] text-[#78716C] dark:text-[#CFC5BE]">{metric.title}</p>
                    <p className="text-[14px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
                    <p className="text-[11px] text-[#A8A29E] dark:text-[#B8B1AC]">{metric.hint}</p>
                  </article>
                ))}
              </div>
            </section>

            <section
              className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-status-pattern-card"
            >
              <div className="flex items-center text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                <Flame size={15} className="mr-2 text-[#C75B3A]" />
                行为模式
                <span className="ml-auto text-xs font-normal text-[#A8A29E]">{data.status.behaviorCompletionText}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {data.status.behaviorPatterns.map((pattern) => (
                  <article key={pattern.id} className="rounded-xl border border-[#F0ECE8] bg-white p-2 dark:border-[#3A3432] dark:bg-[#24201E]">
                    <p className="text-[12px] font-medium text-[#44403C] dark:text-[#E7E5E4]">{pattern.title}</p>
                    <p className={`mt-1 inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${behaviorStateClass(pattern)}`}>
                      {pattern.streakText}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section
              className="space-y-2 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-status-history-card"
            >
              <div className="flex items-center text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                <TrendingUp size={15} className="mr-2 text-[#8B5CF6]" />
                模式历史
              </div>
              {data.status.historyItems.map((item) => (
                <article key={item.id} className="rounded-xl bg-[#FAF7F5] p-3 dark:bg-[#2A2523]">
                  <div className="flex items-center">
                    <p className="text-[12px] font-medium text-[#44403C] dark:text-[#E7E5E4]">{item.title}</p>
                    <span className={`ml-auto text-[11px] font-semibold ${historyDeltaClass(item)}`}>{item.deltaText}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#A8A29E] dark:text-[#B8B1AC]">{item.detail}</p>
                </article>
              ))}
            </section>
          </div>

          <div data-tab-id="learn" className="space-y-4">
            <section
              className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-learn-urgent-card"
            >
              <div className="flex items-center text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                <Flame size={15} className="mr-2 text-[#E76F51]" />
                急需知识
              </div>
              {data.learn.urgentItems.map((item) => (
                <article
                  key={item.id}
                  className={`rounded-xl border border-[#F0ECE8] p-3 dark:border-[#3A3432] ${learnItemToneClass(item)}`}
                >
                  <div className="flex items-center">
                    <p className="text-[13px] font-medium text-[#292524] dark:text-[#F5F5F4]">{item.title}</p>
                    <span className="ml-auto text-[11px] font-semibold text-[#C75B3A]">{item.priorityText}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#A8A29E] dark:text-[#B8B1AC]">→ {item.source}</p>
                </article>
              ))}
            </section>

            <section
              className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-learn-board-card"
            >
              <div className="flex items-center text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                <BookOpenText size={15} className="mr-2 text-[#C75B3A]" />
                知识看板
              </div>
              {data.learn.lanes.map((lane) => (
                <article key={lane.id} className="rounded-xl border border-[#F0ECE8] bg-white p-3 dark:border-[#3A3432] dark:bg-[#24201E]">
                  <div className="flex items-center">
                    <p className="text-[13px] font-semibold text-[#44403C] dark:text-[#E7E5E4]">{lane.title}</p>
                    <span className="ml-auto text-[11px] text-[#A8A29E] dark:text-[#B8B1AC]">{lane.countText}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#A8A29E] dark:text-[#B8B1AC]">{lane.progressText}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {lane.tags.map((tag) => (
                      <span key={tag} className="rounded-md bg-[#F5F0ED] px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#3A3432] dark:text-[#D6D3D1]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </div>

          <div data-tab-id="implicit" className="space-y-4">
            <section
              className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-implicit-belief-card"
            >
              <div className="flex items-center text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                <Network size={15} className="mr-2 text-[#C75B3A]" />
                信念网络
              </div>
              <div className="relative h-[160px] rounded-xl bg-[#FAF7F5] dark:bg-[#2A2523]">
                {data.implicit.beliefNodes.map((node) => (
                  <span
                    key={node.id}
                    className={`absolute inline-flex rounded-full px-3 py-1 text-[11px] ${
                      node.emphasis === 'primary'
                        ? 'bg-[#C75B3A] text-white'
                        : node.emphasis === 'secondary'
                          ? 'bg-[#FDECEA] text-[#8B3A25]'
                          : 'bg-[#F5F0ED] text-[#78716C]'
                    }`}
                    style={{ left: `${node.x}px`, top: `${node.y}px` }}
                  >
                    {node.label}
                  </span>
                ))}
              </div>
            </section>

            <section
              className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
              data-testid="me-implicit-habit-card"
            >
              <div className="flex items-center text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                <BrainCircuit size={15} className="mr-2 text-[#C75B3A]" />
                习惯回路
              </div>
              {data.implicit.habitLoops.map((loop) => (
                <article
                  key={loop.id}
                  className={`rounded-xl p-3 ${habitLoopToneClass(loop)}`}
                >
                  <div className="flex items-center">
                    <p className="text-[12px] font-semibold text-[#44403C] dark:text-[#F5F5F4]">{loop.name}</p>
                    <span className="ml-auto text-[11px] text-[#78716C] dark:text-[#D6D3D1]">{loop.frequencyText}</span>
                  </div>
                  <p className="mt-1 flex items-center text-[11px] text-[#78716C] dark:text-[#D6D3D1]">
                    <CircleDot size={12} className="mr-1.5" />
                    线索：{loop.cue}
                  </p>
                  <p className="mt-1 text-[11px] text-[#78716C] dark:text-[#D6D3D1]">行为：{loop.routine}</p>
                  <p className="mt-1 text-[11px] text-[#78716C] dark:text-[#D6D3D1]">奖励：{loop.reward}</p>
                </article>
              ))}
            </section>
          </div>
        </PageTabs>
      </div>
    </PageShell>
  );
}
