import type { FocusEventHandler, MouseEventHandler, ReactNode } from 'react';
import { ArrowUpRight, Expand, Shrink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FocusTimerOverlayChrome } from './FocusTimerView';

// Extracted from Alpha's live NowWorkbenchOverlayPage, not its static preview.
// Geometry is also consumed by the Alpha native-window resize adapter.
export const NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE = { width: 390, height: 192 };
const ACTIVE_VISIBLE_SURFACE_CLASS = 'ring-1 ring-inset ring-[#FDE4DE]/60';

export interface NowWorkbenchOverlayViewModel {
  mode: 'running' | 'idle';
  title: string;
  statusLabel: string;
  clockText: string;
  paused: boolean;
  miniCollapsed: boolean;
  miniHovered: boolean;
  idleExpanded: boolean;
  surfaceActive: boolean;
  nudge?: { title: string; body: string; ctaLabel: string };
}
export interface NowWorkbenchOverlayViewProps {
  model: NowWorkbenchOverlayViewModel;
  actionsDisabled?: boolean;
  pauseDisabled?: boolean;
  onMiniHover(hovered: boolean): void;
  onIdleHover(hovered: boolean): void;
  onIdleFocusCapture: FocusEventHandler<HTMLDivElement>;
  onIdleBlurCapture: FocusEventHandler<HTMLDivElement>;
  onIdleCollapse(): void;
  onExpand(): void;
  onCollapse(): void;
  onReturnToMain(): void;
  onPauseOrResume(): void;
  onEndBlock(): void | Promise<void>;
  onSurfaceMount(node: HTMLElement | null): void;
  onSurfaceMouseDownCapture: MouseEventHandler<HTMLElement>;
  slots: {
    running(chrome: FocusTimerOverlayChrome): ReactNode;
    record: ReactNode;
    dialogs?: ReactNode;
  };
}

/** Controlled presentation only. Window sizing/position, clocks, business
 * controllers and draft ownership stay with the caller. Slots retain Alpha's
 * original mount/unmount behavior when the visible branch changes. */
export function NowWorkbenchOverlayView({
  model, actionsDisabled = false, pauseDisabled = false, onMiniHover, onIdleHover, onIdleFocusCapture, onIdleBlurCapture,
  onIdleCollapse, onExpand, onCollapse, onReturnToMain, onPauseOrResume,
  onEndBlock, onSurfaceMount, onSurfaceMouseDownCapture, slots,
}: NowWorkbenchOverlayViewProps) {
  const isLiveRunningSingleCardMode = model.mode === 'running';
  const isLiveRunningMiniMode = isLiveRunningSingleCardMode && model.miniCollapsed;
  const isLiveRunningMiniPeekMode = isLiveRunningMiniMode && model.miniHovered;
  const isLiveIdleBubbleMode = model.mode === 'idle';
  const isIdleExpanded = model.idleExpanded;
  const shouldMeasureIdleBubbleShell = isLiveIdleBubbleMode && Boolean(model.nudge);
  const isVisibleSurfaceActive = model.surfaceActive;
  if (isLiveRunningMiniMode) {
    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--mini">
        <div className="now-workbench-overlay-shell now-workbench-overlay-shell--mini">
          <div
            data-testid="now-overlay-collapsed-pill"
            onMouseEnter={() => onMiniHover(true)}
            onMouseLeave={() => onMiniHover(false)}
            ref={onSurfaceMount}
            data-overlay-visible-surface="true"
            onMouseDownCapture={onSurfaceMouseDownCapture}
            className={`rounded-[22px] border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9] shadow-[0_16px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-[20px] ${
              isLiveRunningMiniPeekMode
                ? 'w-[328px] px-4 py-3'
                : 'w-[224px] px-3 py-2'
            } ${isVisibleSurfaceActive ? ACTIVE_VISIBLE_SURFACE_CLASS : ''}`}
          >
            {isLiveRunningMiniPeekMode ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div
                    data-testid="now-overlay-drag-handle"
                    data-tauri-drag-region

                    className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                    title="按住这里拖动窗口"
                  >
                    <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6D3D1]" data-tauri-drag-region>
                      {model.statusLabel}
                    </p>
                    <p className="truncate text-[14px] font-semibold text-[#FAFAF9]" data-tauri-drag-region>
                      {model.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onExpand()}
                      aria-label="展开"
                      title="展开"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                    >
                      <Expand size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onReturnToMain}
                      aria-label="显示主程序"
                      title="显示主程序"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                    >
                      <ArrowUpRight size={16} />
                    </Button>
                  </div>
                </div>
                <p
                  data-testid="now-overlay-collapsed-clock"
                  className="font-mono text-[34px] leading-none tracking-[0.08em] text-[#FDE4DE]"
                >
                  {model.clockText}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={actionsDisabled || pauseDisabled}
                    onClick={onPauseOrResume}
                    className="h-9 rounded-[12px] bg-white/10 px-4 text-[#FAFAF9] hover:bg-white/15"
                  >
                    {model.paused ? '继续' : '暂停'}
                  </Button>
                  <Button
                    type="button"
                    variant="brand"
                    disabled={actionsDisabled}
                    onClick={onEndBlock}
                    className="h-9 rounded-[12px] bg-[#C75B3A] px-4 text-white hover:bg-[#B24D2F]"
                  >
                    结束
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div
                  data-testid="now-overlay-drag-handle"
                  data-tauri-drag-region

                  className="min-w-0 flex-1 cursor-grab select-none active:cursor-grabbing"
                  title="按住这里拖动窗口"
                >
                  <p className="font-mono text-[28px] leading-none tracking-[0.08em] text-[#FDE4DE]" data-testid="now-overlay-collapsed-clock" data-tauri-drag-region>
                    {model.clockText}
                  </p>
                  <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6D3D1]" data-tauri-drag-region>
                    {model.statusLabel}
                  </p>
                  <p className="truncate text-[12px] text-[#FAFAF9]/85" data-tauri-drag-region>
                    {model.title}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 flex-col items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onExpand()}
                    aria-label="展开"
                    title="展开"
                    className="h-7 w-7 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                  >
                    <Expand size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onReturnToMain}
                    aria-label="显示主程序"
                    title="显示主程序"
                    className="h-7 w-7 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                  >
                    <ArrowUpRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {slots.dialogs}
        <style>{NOW_WORKBENCH_OVERLAY_STYLES}</style>
      </div>
    );
  }

  if (isLiveIdleBubbleMode) {

    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--mini">
        <div
          ref={shouldMeasureIdleBubbleShell ? onSurfaceMount : undefined}
          data-overlay-visible-surface={shouldMeasureIdleBubbleShell ? 'true' : undefined}
          className="now-workbench-overlay-shell now-workbench-overlay-shell--mini space-y-3"
        >
          {model.nudge ? (
            <section
              data-testid="now-overlay-ritual-nudge"
              className="w-[320px] rounded-[18px] border border-[#F0D8D0] bg-[#FFF6F3] px-4 py-3 text-[#7C2D12] shadow-[0_18px_36px_-28px_rgba(0,0,0,0.4)] backdrop-blur-[18px] dark:border-[#4A2C24] dark:bg-[#2A1712] dark:text-[#FED7AA]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{model.nudge.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#9A3412] dark:text-[#FCD9B6]">{model.nudge.body}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onReturnToMain}
                  className="shrink-0 rounded-[10px] border-[#E9B8A7] bg-white/75 text-[#9A3412] hover:bg-[#FFF1EB] dark:border-[#6B3F32] dark:bg-[#3A211A] dark:text-[#FED7AA] dark:hover:bg-[#4A2C24]"
                >
                  {model.nudge.ctaLabel}
                </Button>
              </div>
            </section>
          ) : null}

          {isIdleExpanded ? (
            <div
              data-testid="now-overlay-idle-expanded"
              onMouseEnter={() => onIdleHover(true)}
              onMouseLeave={() => onIdleHover(false)}
              onFocusCapture={onIdleFocusCapture}
              onBlurCapture={onIdleBlurCapture}
              ref={shouldMeasureIdleBubbleShell ? undefined : onSurfaceMount}
              data-overlay-visible-surface={shouldMeasureIdleBubbleShell ? undefined : 'true'}
              onMouseDownCapture={onSurfaceMouseDownCapture}
              className={`w-[396px] rounded-[24px] border border-white/10 bg-[rgba(33,24,20,0.92)] px-4 py-4 text-[#F5EDE7] shadow-[0_20px_48px_-28px_rgba(0,0,0,0.55)] backdrop-blur-[24px] ${
                isVisibleSurfaceActive ? ACTIVE_VISIBLE_SURFACE_CLASS : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  data-testid="now-overlay-drag-handle"
                  data-tauri-drag-region

                  className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                  title="按住这里拖动窗口"
                >
                  <div className="flex items-center gap-2" data-tauri-drag-region>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#A8A29E]" data-tauri-drag-region />
                    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#78716C] dark:text-[#A8A29E]" data-tauri-drag-region>
                      当下
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[16px] font-semibold" data-tauri-drag-region>
                    现在先记点什么
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onIdleCollapse}
                    aria-label="收起"
                    title="收起"
                    className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                  >
                    <Shrink size={15} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onReturnToMain}
                    aria-label="显示主程序"
                    title="显示主程序"
                    className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                  >
                    <ArrowUpRight size={15} />
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <section
                  data-testid="now-overlay-empty-state"
                  className="rounded-[18px] border border-dashed border-white/10 bg-white/6 px-4 py-4 text-center"
                >
                  <p className="text-[14px] font-medium text-[#57534E] dark:text-[#D6D3D1]">时间块尚未开始</p>
                  <p className="mt-1 text-[12px] text-[#A8A29E] dark:text-[#78716C]">可以在这里快速记录，或回主程序开始专注。</p>
                </section>
                <section className="overflow-hidden rounded-[18px] border border-white/10 bg-white/8">
                  {slots.record}
                </section>
              </div>
            </div>
          ) : (
            <div
              data-testid="now-overlay-idle-pill"
              onMouseEnter={() => onIdleHover(true)}
              ref={shouldMeasureIdleBubbleShell ? undefined : onSurfaceMount}
              data-overlay-visible-surface={shouldMeasureIdleBubbleShell ? undefined : 'true'}
              onMouseDownCapture={onSurfaceMouseDownCapture}
              className={`w-[252px] rounded-[22px] border border-white/10 bg-[rgba(33,24,20,0.88)] px-4 py-3 text-[#F5EDE7] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.55)] backdrop-blur-[22px] ${
                isVisibleSurfaceActive ? ACTIVE_VISIBLE_SURFACE_CLASS : ''
              }`}
            >
              <div
                data-testid="now-overlay-drag-handle"
                data-tauri-drag-region

                className="cursor-grab select-none active:cursor-grabbing"
                title="按住这里拖动窗口"
              >
                <div className="flex items-center gap-2" data-tauri-drag-region>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#A8A29E]" data-tauri-drag-region />
                  <span className="text-[15px] font-semibold text-[#D6D3D1] dark:text-[#E7E5E4]" data-tauri-drag-region>
                    当下
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-medium text-[#78716C] dark:text-[#A8A29E]" data-tauri-drag-region>
                  · 随时记录
                </p>
              </div>
            </div>
          )}
        </div>

        {slots.dialogs}
        <style>{NOW_WORKBENCH_OVERLAY_STYLES}</style>
      </div>
    );
  }

  if (isLiveRunningSingleCardMode) {
    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--single-card">
        <div
          data-testid="now-overlay-single-card-shell"
          className="now-workbench-overlay-shell now-workbench-overlay-shell--single-card"
        >
          <main className="flex min-h-0 flex-1 items-center justify-center">
            <div
              data-testid="now-overlay-single-card-stage"
              className="shrink-0"
              style={{
                width: NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE.width,
                maxWidth: NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE.width,
              }}
            >
              {slots.running({
                statusLabel: model.statusLabel,
                onCollapse,
                onReturnToMain,
                onSurfaceMount,
                onSurfaceMouseDownCapture,
                surfacePressed: model.surfaceActive,
              })}
            </div>
          </main>
        </div>

        {slots.dialogs}
        <style>{NOW_WORKBENCH_OVERLAY_STYLES}</style>
      </div>
    );
  }

  return null;
}

export const NOW_WORKBENCH_OVERLAY_STYLES = /* css */ `
  html, body, #root {
    width: 100%;
    height: 100%;
  }

  body {
    margin: 0;
    background: transparent !important;
    overflow: hidden;
  }

  .now-workbench-overlay-root {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    padding: 10px;
    box-sizing: border-box;
  }

  .now-workbench-overlay-shell {
    width: min(392px, calc(100vw - 20px));
    height: calc(100vh - 20px);
    max-height: calc(100vh - 20px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .now-workbench-overlay-root--single-card {
    padding: 0;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .now-workbench-overlay-shell--single-card {
    width: auto;
    height: auto;
    max-height: none;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    overflow: visible;
    padding-top: 0;
  }

  .now-workbench-overlay-root--mini {
    padding: 0;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .now-workbench-overlay-shell--mini {
    width: auto;
    height: auto;
    max-height: none;
    min-height: 0;
    overflow: visible;
  }
`;
