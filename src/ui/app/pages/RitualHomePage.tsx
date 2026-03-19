type RitualHomeStage = 'pre_boot' | 'intent_setup' | 'day_hub' | 'shutdown_ready' | 'shutdown_done';

interface RitualHomePageProps {
  stage?: RitualHomeStage;
}

export function RitualHomePage({ stage = 'pre_boot' }: RitualHomePageProps) {
  if (stage === 'pre_boot') {
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
