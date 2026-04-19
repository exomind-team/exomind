import { useLocation } from '@tanstack/react-router';
import { Bot, ExternalLink, Network, TerminalSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  getSelectedRuntimeTarget,
  subscribeRuntimeTargetChanges,
  toRuntimeBaseUrl,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { useSessionStream } from '@/hooks/useSessionStream';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

import {
  applyWorkbenchLegacyIntent,
  buildWorkbenchPanesFromSessions,
  readOrCreateWorkbenchFlatState,
  resolveWorkbenchLegacyIntent,
  writeWorkbenchFlatState,
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

function openWorkbenchPane(path: string | undefined) {
  if (!path || typeof window === 'undefined') {
    return;
  }

  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function WorkbenchPaneCard({ pane }: { pane: WorkbenchPaneState }) {
  const presentation = PANE_PRESENTATIONS[pane.bindingType];
  const Icon = presentation.icon;

  return (
    <article
      data-testid={`workbench-pane-${pane.bindingType}`}
      className="flex min-h-[240px] flex-col gap-4 rounded-[24px] border border-[#E7E0D8] bg-white/95 p-5 shadow-[0_20px_50px_-34px_rgba(28,25,23,0.28)] dark:border-[#2A2523] dark:bg-[#171312]"
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
          <p>
            View kind（视图类型）: <code className="exomind-selectable">{pane.viewKind}</code>
          </p>
          <p>
            Binding type（绑定类型）: <code className="exomind-selectable">{pane.bindingType}</code>
          </p>
          <p>
            Session id（会话 ID）: <code className="exomind-selectable">{pane.sessionId ?? 'fallback-pane'}</code>
          </p>
          <p>
            Destination（目标页）: <code className="exomind-selectable">{pane.openPath ?? 'not available / 暂不可跳转'}</code>
          </p>
        </div>
      </div>

      <button
        type="button"
        data-testid={`workbench-pane-open-${pane.id}`}
        onClick={() => openWorkbenchPane(pane.openPath)}
        disabled={!pane.openPath}
        className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-[#E7E0D8] bg-[#FFF7F2] px-4 py-3 text-sm font-semibold text-[#9A3412] transition hover:bg-[#FDEDDC] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#3A2B24] dark:bg-[#201714] dark:text-[#FDBA74]"
      >
        <ExternalLink size={16} />
        Open legacy destination / 打开旧目标
      </button>
    </article>
  );
}

export function WorkbenchPage() {
  const isDesktop = useIsDesktop(1024);
  const location = useLocation();
  const [runtimeTarget, setRuntimeTarget] = useState<RuntimeTarget>(() => getSelectedRuntimeTarget());

  useEffect(() => subscribeRuntimeTargetChanges(setRuntimeTarget), []);

  const legacyIntent = useMemo(
    () => resolveWorkbenchLegacyIntent(location.searchStr ?? ''),
    [location.searchStr],
  );

  const storedState = useMemo(
    () => applyWorkbenchLegacyIntent(readOrCreateWorkbenchFlatState(), legacyIntent),
    [legacyIntent],
  );

  const { sessions, loading, error } = useSessionStream({
    rtBaseUrl: toRuntimeBaseUrl(runtimeTarget),
    authToken: runtimeTarget.authToken,
    enabled: true,
  });

  const panes = useMemo(
    () => buildWorkbenchPanesFromSessions(sessions, storedState.panes),
    [sessions, storedState.panes],
  );

  useEffect(() => {
    writeWorkbenchFlatState({
      ...storedState,
      panes,
    });
  }, [panes, storedState]);

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
                  先交付一个稳定的多 pane 工作面，把 runtime session 映射成可点击的 pane；
                  drag-and-drop（拖拽编排）仍未实现。
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
                  {storedState.space.name}
                </div>
                <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {storedState.space.id}
                </div>
                <div className="mt-1 text-[11px] text-[#A8A29E]">
                  {storedState.surface.id} / {storedState.surface.layoutPreset}
                </div>
              </div>

              <div className="rounded-[20px] border border-[#E7E0D8] bg-[#FAF7F5] px-4 py-3 dark:border-[#302A27] dark:bg-[#120F0E]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A8A29E]">
                  Runtime Feed
                </div>
                <div className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                  {loading ? 'Streaming… / 正在连接' : `${panes.length} panes ready / 已准备 ${panes.length} 个 pane`}
                </div>
                <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {error ? `Fallback mode / 回退模式: ${error}` : `RT ${runtimeTarget.host}:${runtimeTarget.port}`}
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
            Legacy route handoff / 旧入口接力：<code className="exomind-selectable">{legacyIntent.route}</code>
          </section>
        ) : null}

        <section
          className="rounded-[20px] border border-[#E7E0D8] bg-white/80 px-4 py-3 text-sm text-[#57534E] dark:border-[#2A2523] dark:bg-[#171312]/80 dark:text-[#D6D3D1]"
        >
          Phase 1 note / 阶段说明：当前工作台负责“恢复空间 + 展示 pane + 跳回旧入口”，不负责拖拽布局与 pane 内联交互。
        </section>

        <section
          data-testid="workbench-pane-grid"
          className={isDesktop ? 'grid grid-cols-2 gap-5' : 'grid grid-cols-1 gap-4'}
        >
          {panes.map((pane) => (
            <WorkbenchPaneCard key={pane.id} pane={pane} />
          ))}
        </section>
      </div>
    </div>
  );
}
