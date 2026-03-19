import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { buildMorningPlanCandidates, type MorningPlanCandidate } from '@/ui/app/ritual/ritual-recommendation';
import { resolveRitualStage } from '@/ui/app/ritual/ritual-session';
import {
  getTodayRitualDayKey,
  loadRitualSession,
  saveRitualSession,
} from '@/ui/app/ritual/ritual-session-storage';

type RitualHomeStage = 'pre_boot' | 'intent_setup' | 'day_hub' | 'shutdown_ready' | 'shutdown_done';

interface RitualHomePageProps {
  stage?: RitualHomeStage;
  morningPlans?: MorningPlanCandidate[];
}

export function RitualHomePage({ stage = 'pre_boot', morningPlans }: RitualHomePageProps) {
  const [session, setSession] = useState(() => loadRitualSession());
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => session.selectedPlanId);
  const derivedStage = useMemo(() => {
    if (stage !== 'pre_boot') {
      return stage;
    }

    return resolveRitualStage(session);
  }, [session, stage]);

  if (stage === 'pre_boot') {
    const plans = morningPlans ?? buildMorningPlanCandidates({
      carryOverTask: '先把今天主线往前推进一小步',
      blockers: ['把最影响推进的阻塞先清掉'],
      fixedPoints: ['晚上收工前做一次回看'],
      energy: 'medium',
    });
    const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

    if (derivedStage === 'day_hub') {
      return (
        <main className="flex min-h-full flex-col bg-[#F7F2EE] px-4 py-6 text-[#1C1917] dark:bg-[#0C0A09] dark:text-[#FAFAF9] md:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
            <section className="rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(250,247,245,0.86)_100%)] px-6 py-7 shadow-[0_24px_56px_-32px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.9)_0%,rgba(12,10,9,0.82)_100%)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#A8A29E] dark:text-[#78716C]">
                白天中枢
              </p>
              <h1 className="mt-3 text-[30px] font-semibold leading-tight">今天主线</h1>
              <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                {selectedPlan?.title ?? '今天已经开始，继续把主线往前推。'}
              </p>

              <section className="mt-6 rounded-[22px] border border-[#E7E5E4] bg-white/82 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/74">
                <h2 className="text-sm font-semibold">继续今天</h2>
                <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                  现在不用重新规划，直接回到执行入口，把主线往前推进。
                </p>
                <Button type="button" variant="outline" className="mt-4 rounded-[12px]">
                  继续今天
                </Button>
              </section>
            </section>
          </div>
        </main>
      );
    }

    return (
      <main className="flex min-h-full flex-col bg-[#F7F2EE] px-4 py-6 text-[#1C1917] dark:bg-[#0C0A09] dark:text-[#FAFAF9] md:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
          <section className="rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(250,247,245,0.86)_100%)] px-6 py-7 shadow-[0_24px_56px_-32px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.9)_0%,rgba(12,10,9,0.82)_100%)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#A8A29E] dark:text-[#78716C]">
              今日开机
            </p>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight">开始今天</h1>
            <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
              先看状态，再定今天主线。不要一开机就被任务和输入淹没。
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <section className="rounded-[20px] border border-[#E7E5E4] bg-white/78 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/76">
                <h2 className="text-sm font-semibold">今天状态</h2>
                <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                  先确认身体、精神和今天的大致模式。
                </p>
              </section>

              <section className="rounded-[20px] border border-[#E7E5E4] bg-white/78 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/76">
                <h2 className="text-sm font-semibold">昨天停在哪</h2>
                <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                  看一眼昨天最后停下的位置，今天不要从废墟重启。
                </p>
              </section>
            </div>

            <section className="mt-6 rounded-[22px] border border-[#E7E5E4] bg-white/82 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/74">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">系统推荐的今天主线</h2>
                  <p className="mt-1 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                    先从 2 到 3 条收束后的建议里选一条，再决定今天怎么开始。
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {plans.map((plan) => (
                  <section
                    key={plan.id}
                    className={`rounded-[18px] border px-4 py-4 ${
                      selectedPlanId === plan.id
                        ? 'border-[#D97757] bg-[#FFF0EA] dark:border-[#A44C33] dark:bg-[#2A1610]'
                        : 'border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#3A3632] dark:bg-[#15110F]'
                    }`}
                  >
                    <h3 className="text-sm font-semibold">{plan.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                      目标结果：{plan.targetOutcome}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[#8C7D78] dark:text-[#A8A29E]">
                      建议节奏：{plan.suggestedWindows.join(' · ')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 rounded-[12px]"
                      onClick={() => setSelectedPlanId(plan.id)}
                    >
                      选择这条主线
                    </Button>
                  </section>
                ))}
              </div>
            </section>

            <div className="mt-6 flex items-center justify-end">
              <Button
                type="button"
                className="rounded-[12px] bg-[#C75B3A] text-white hover:bg-[#B24D2F]"
                disabled={!selectedPlan}
                onClick={() => {
                  if (!selectedPlan) {
                    return;
                  }

                  const nextSession = {
                    ...session,
                    dayKey: getTodayRitualDayKey(),
                    bootedAt: session.bootedAt ?? Date.now(),
                    selectedPlanId: selectedPlan.id,
                  };
                  saveRitualSession(nextSession);
                  setSession(nextSession);
                }}
              >
                开始今天
              </Button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (stage === 'shutdown_ready') {
    return (
      <main className="flex min-h-full flex-col bg-[#F6F1EC] px-4 py-6 text-[#1C1917] dark:bg-[#0C0A09] dark:text-[#FAFAF9] md:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
          <section className="rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(250,247,245,0.88)_100%)] px-6 py-7 shadow-[0_24px_56px_-32px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.92)_0%,rgba(12,10,9,0.84)_100%)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#A8A29E] dark:text-[#78716C]">
              今日收工
            </p>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight">收住今天</h1>
            <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
              先把今天落住，再决定明天从哪里继续。
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <section className="rounded-[20px] border border-[#E7E5E4] bg-white/80 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/76">
                <h2 className="text-sm font-semibold">今天完成了什么</h2>
                <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                  用很短的话记住今天最重要的一步结果。
                </p>
              </section>

              <section className="rounded-[20px] border border-[#E7E5E4] bg-white/80 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/76">
                <h2 className="text-sm font-semibold">今天卡在哪里</h2>
                <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                  留下阻塞点，明天就不会重新踩一遍。
                </p>
              </section>
            </div>

            <section className="mt-6 rounded-[22px] border border-[#E7E5E4] bg-white/82 px-4 py-4 dark:border-[#292524] dark:bg-[#1C1917]/74">
              <h2 className="text-sm font-semibold">明天第一步</h2>
              <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                明天一打开外心，先从这里继续，不要重新发散。
              </p>
              <Button type="button" className="mt-4 rounded-[12px] bg-[#C75B3A] text-white hover:bg-[#B24D2F]">
                正式收工
              </Button>
            </section>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-[#FAF7F5] px-4 py-6 dark:bg-[#0C0A09]">
      <section className="rounded-[24px] border border-[#E7E5E4] bg-white px-5 py-4 text-sm text-[#57534E] shadow-sm dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
        Ritual Home stage: {stage}
      </section>
    </main>
  );
}
