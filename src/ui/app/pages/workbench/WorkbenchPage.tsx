import { useLocation } from '@tanstack/react-router';
import { Bot, Network, TerminalSquare } from 'lucide-react';
import { useMemo } from 'react';

import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

import {
  applyWorkbenchLegacyIntent,
  readOrCreateWorkbenchFlatState,
  resolveWorkbenchLegacyIntent,
  type WorkbenchBindingType,
  type WorkbenchPaneState,
} from './workbench-storage';

type PanePresentation = {
  badge: string;
  icon: typeof Bot;
  accentClassName: string;
};

const PANE_PRESENTATIONS: Record<WorkbenchBindingType, PanePresentation> = {
  'agent-session': {
    badge: 'Agent Session / Agent 会话',
    icon: Bot,
    accentClassName: 'border-[#C75B3A]/30 bg-[#FFF7F2] text-[#9A3412]',
  },
  'pty-runtime': {
    badge: 'PTY Runtime / PTY 终端',
    icon: TerminalSquare,
    accentClassName: 'border-[#1D4ED8]/30 bg-[#EFF6FF] text-[#1D4ED8]',
  },
  'ssh-runtime': {
    badge: 'SSH Runtime / SSH 终端',
    icon: TerminalSquare,
    accentClassName: 'border-[#0F766E]/30 bg-[#F0FDFA] text-[#115E59]',
  },
  'browser-runtime': {
    badge: 'Browser Runtime / 浏览器运行时',
    icon: Network,
    accentClassName: 'border-[#7C3AED]/30 bg-[#F5F3FF] text-[#6D28D9]',
  },
};

function WorkbenchPaneCard({ pane }: { pane: WorkbenchPaneState }) {
  const presentation = PANE_PRESENTATIONS[pane.bindingType];
  const Icon = presentation.icon;

  return (
    <article
      data-testid={`workbench-pane-${pane.bindingType}`}
      className="flex min-h-[220px] flex-col gap-4 rounded-[24px] border border-[#E7E0D8] bg-white/95 p-5 shadow-[0_20px_50px_-34px_rgba(28,25,23,0.28)] dark:border-[#2A2523] dark:bg-[#171312]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${presentation.accentClassName}`}
          >
            <Icon size={14} />
            {presentation.badge}
          </span>
          <div>
            <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              {pane.title}
            </h2>
            <p className="mt-1 text-sm text-[#57534E] dark:text-[#D6D3D1]">
              {pane.description}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[#F5F0ED] px-2.5 py-1 text-[11px] font-medium text-[#57534E] dark:bg-[#26211F] dark:text-[#D6D3D1]">
          {pane.status}
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between rounded-[18px] border border-dashed border-[#DED6CF] bg-[#FAF7F5] p-4 dark:border-[#332D2A] dark:bg-[#120F0E]">
        <div className="flex items-center gap-2 text-sm font-medium text-[#292524] dark:text-[#F5F5F4]">
          <Network size={14} />
          Phase 1 Flat Workbench / 平铺工作台
        </div>
        <div className="mt-4 space-y-2 text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">
          <p>View kind（视图类型）: <code>{pane.viewKind}</code></p>
          <p>Binding type（绑定类型）: <code>{pane.bindingType}</code></p>
          <p>Source of truth（事实源）: EventTape ready / 事实层预留</p>
          <p>Current focus（当前焦点）: visible pane / 当前可见工作面</p>
        </div>
      </div>
    </article>
  );
}

export function WorkbenchPage() {
  const isDesktop = useIsDesktop(1024);
  const location = useLocation();
  const legacyIntent = useMemo(
    () => resolveWorkbenchLegacyIntent(location.searchStr ?? ''),
    [location.searchStr],
  );
  const state = useMemo(
    () => applyWorkbenchLegacyIntent(readOrCreateWorkbenchFlatState(), legacyIntent),
    [legacyIntent],
  );

  return (
    <div
      data-testid="workbench-page"
      className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(199,91,58,0.12),transparent_28%),linear-gradient(180deg,#FBF7F4_0%,#F5EFEA_100%)] px-4 py-5 text-[#1C1917] dark:bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.12),transparent_28%),linear-gradient(180deg,#120F0E_0%,#0C0A09_100%)] dark:text-[#FAFAF9] md:px-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rounded-[28px] border border-[#E7E0D8] bg-white/90 p-5 shadow-[0_22px_60px_-38px_rgba(28,25,23,0.3)] dark:border-[#2A2523] dark:bg-[#171312]/90">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#A16207] dark:text-[#F59E0B]">
                Phase 1 / Flat Workbench
              </p>
              <div>
                <h1 className="text-2xl font-semibold md:text-3xl">
                  Agent Workbench / Agent 工作台
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                  先交付一个稳定的多 pane 工作面，把 agent session 与 SSH runtime 放进同一个共享空间语义里。
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-[#E7E0D8] bg-[#FAF7F5] px-4 py-3 dark:border-[#302A27] dark:bg-[#120F0E]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A8A29E]">
                  Current Space
                </div>
                <div
                  data-testid="workbench-space-name"
                  className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
                >
                  {state.space.name}
                </div>
                <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {state.space.id}
                </div>
                <div className="mt-1 text-[11px] text-[#A8A29E]">
                  {state.surface.id} / {state.surface.layoutPreset}
                </div>
              </div>

              <div className="rounded-[20px] border border-[#E7E0D8] bg-[#FAF7F5] px-4 py-3 dark:border-[#302A27] dark:bg-[#120F0E]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A8A29E]">
                  Restore Marker
                </div>
                <div className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                  Recent panes ready
                </div>
                <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {state.space.restoredAt}
                </div>
              </div>
            </div>
          </div>
        </header>

        {legacyIntent ? (
          <section
            data-testid="workbench-legacy-entry"
            className="rounded-[20px] border border-[#E9D5FF] bg-[#FAF5FF] px-4 py-3 text-sm text-[#6B21A8] shadow-[0_12px_36px_-30px_rgba(109,40,217,0.45)] dark:border-[#4C1D95] dark:bg-[#1E1433] dark:text-[#E9D5FF]"
          >
            Legacy route handoff / 旧入口接力：<code>{legacyIntent.route}</code>
          </section>
        ) : null}

        <section
          data-testid="workbench-pane-grid"
          className={isDesktop ? 'grid grid-cols-2 gap-5' : 'grid grid-cols-1 gap-4'}
        >
          {state.panes.map((pane) => (
            <WorkbenchPaneCard key={pane.id} pane={pane} />
          ))}
        </section>
      </div>
    </div>
  );
}
