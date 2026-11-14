import type {
  ChangeEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  Ref,
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Music4,
  NotepadText,
  Pause,
  Play,
  Shrink,
  Square,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type FocusTimerSurface = "default" | "overlay";
export type FocusTimerMode = "countup" | "countdown";

export type FocusTimerViewModel =
  | { phase: "idle" }
  | {
      phase: "config";
      name: string;
      mode: FocusTimerMode;
      minutes: number;
      custom: { editing: boolean; draft: string };
    }
  | {
      phase: "running";
      name: { text: string; draft: string; editing: boolean; saving: boolean; readOnly?: boolean };
      // The controller supplies these strings from its authoritative clock.
      // This presentation never advances time or submits an ending itself.
      clock: { text: string; warning: boolean; endTimeText?: string };
      paused: boolean;
      feedback: { inProgress: boolean; dialogOpen: boolean };
      // Alpha-only display labels, not TaskNode or task-service capabilities.
      linkedTasks?: readonly { id: string; title: string }[];
    };

export interface FocusTimerViewActions {
  expand: () => void;
  collapse: () => void;
  selectTiming: (mode: FocusTimerMode, minutes?: number) => void;
  editCustom: () => void;
  start: () => void | Promise<unknown>;
  beginRename: () => void;
  pauseResume: () => void | Promise<unknown>;
  end: () => void;
  openBgm?: () => void;
}

export interface FocusTimerFieldBindings<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  inputRef?: Ref<T>;
  onChange?: ChangeEventHandler<T>;
  onFocus?: FocusEventHandler<T>;
  onBlur?: FocusEventHandler<T>;
  onKeyDown?: KeyboardEventHandler<T>;
}

export interface FocusTimerViewBindings {
  configName?: FocusTimerFieldBindings<HTMLTextAreaElement>;
  customMinutes?: FocusTimerFieldBindings<HTMLInputElement>;
  runningName?: FocusTimerFieldBindings<HTMLInputElement>;
  expectedTimeKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

export interface FocusTimerOverlayChrome {
  statusLabel: string;
  onCollapse: () => void;
  onReturnToMain: () => void;
  onSurfaceMount?: (node: HTMLDivElement | null) => void;
  onSurfaceMouseDownCapture?: MouseEventHandler<HTMLDivElement>;
  surfacePressed?: boolean;
}

export interface FocusTimerViewProps {
  model: FocusTimerViewModel;
  actions: FocusTimerViewActions;
  bindings?: FocusTimerViewBindings;
  surface?: FocusTimerSurface;
  overlayChrome?: FocusTimerOverlayChrome;
  slots?: { keepAwake?: ReactNode; dialogs?: ReactNode };
}

// The markup below is extracted from Alpha's FocusTimerWidget. Its controller
// retains services, drafts, RAF, mutations and dialog lifecycle; both hosts use
// this one presentation rather than maintaining similar independent widgets.

function glassCardShadowClass(): string {
  return "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-6px_rgba(0,0,0,0.08),0_20px_40px_-8px_rgba(0,0,0,0.05)]";
}

function expectedOptionClass(active: boolean): string {
  return `relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
    active
      ? "font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
      : "text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]"
  }`;
}

const PRESET_COUNTDOWN_MINUTES = [15, 25, 45] as const;

function isPresetCountdownMinutes(minutes: number): boolean {
  return PRESET_COUNTDOWN_MINUTES.includes(
    minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number],
  );
}

function resolveExpectedOptionIndex(mode: FocusTimerMode, minutes: number): number {
  if (mode === "countup") return 0;
  const presetIndex = PRESET_COUNTDOWN_MINUTES.indexOf(
    minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number],
  );
  return presetIndex >= 0 ? presetIndex + 1 : 4;
}

export function FocusTimerView({
  model,
  actions,
  bindings = {},
  surface = "default",
  overlayChrome: overlayRunningChrome,
  slots = {},
}: FocusTimerViewProps) {
  const uiState = model.phase;
  const config = model.phase === "config" ? model : null;
  const running = model.phase === "running" ? model : null;
  const taskNameDraft = config?.name ?? "";
  const timerMode = config?.mode ?? "countup";
  const countdownMinutes = config?.minutes ?? 0;
  const customDurationDraft = config?.custom.draft ?? "";
  const isCustomDurationEditing = config?.custom.editing ?? false;
  const isCustomDurationSelected =
    timerMode === "countdown" && !isPresetCountdownMinutes(countdownMinutes);
  const customDurationTriggerText = isCustomDurationSelected
    ? String(countdownMinutes) + "m"
    : "自定义";
  const activeExpectedIndex = resolveExpectedOptionIndex(timerMode, countdownMinutes);
  const isPaused = running?.paused ?? false;
  const feedbackInProgress = running?.feedback.inProgress ?? false;
  const feedbackOpen = running?.feedback.dialogOpen ?? false;
  const runningNameDisplayText = running?.name.text ?? "";
  const runningNameDraft = running?.name.draft ?? "";
  const isRunningNameEditing = running?.name.editing ?? false;
  const isRunningNameSaving = running?.name.saving ?? false;
  const clockText = running?.clock.text ?? "";
  const isCountdownWarning = running?.clock.warning ?? false;
  const countdownEndTimeDisplay =
    running && running.clock.endTimeText !== undefined
      ? { text: running.clock.endTimeText }
      : null;
  const linkedTasks = running?.linkedTasks ?? [];
  const taskInputRef = bindings.configName?.inputRef;
  const customDurationInputRef = bindings.customMinutes?.inputRef;
  const runningNameInputRef = bindings.runningName?.inputRef;
  const enterConfigState = actions.expand;
  const handleCollapseToIdle = actions.collapse;
  const handleOpenCustomDurationEditor = actions.editCustom;
  const handleStart = actions.start;
  const handleBeginRunningNameEdit = actions.beginRename;
  const handlePauseOrResume = actions.pauseResume;
  const handleOpenEndDialog = actions.end;
  const handleTaskInputKeyDown = bindings.configName?.onKeyDown;
  const handleExpectedTimeKeyDown = bindings.expectedTimeKeyDown;
  const handleCustomDurationKeyDown = bindings.customMinutes?.onKeyDown;
  const handleRunningNameKeyDown = bindings.runningName?.onKeyDown;
  const hasFocusBgmConfigured = Boolean(actions.openBgm);
  const focusBgmToggleAriaLabel = "背景音设置（Background audio settings）";
  const focusBgmToggleIcon = <Music4 size={16} />;
  const isOverlaySurface = surface === "overlay";
  const overlayChrome = isOverlaySurface
    ? (overlayRunningChrome ?? null)
    : null;
  const hasIntegratedOverlayChrome = overlayChrome !== null;
  const hasRunningLinkedTasks = linkedTasks.length > 0;
  const useAutoHeightConfigLayout = !isOverlaySurface;
  const useAutoHeightRunningLayout =
    !isOverlaySurface || (hasIntegratedOverlayChrome && hasRunningLinkedTasks);
  const baseStageHeightClass = useAutoHeightConfigLayout
    ? "min-h-[200px] pb-4 pt-4"
    : hasIntegratedOverlayChrome
      ? "h-[192px]"
      : "h-[200px]";
  const baseGlowHeightClass = useAutoHeightConfigLayout
    ? "bottom-4"
    : hasIntegratedOverlayChrome
      ? "h-[186px]"
      : "h-[163px]";
  const baseCardHeightClass = useAutoHeightConfigLayout
    ? "min-h-[169px]"
    : hasIntegratedOverlayChrome
      ? "h-[192px]"
      : "h-[169px]";
  const runningStageHeightClass = useAutoHeightRunningLayout
    ? useAutoHeightConfigLayout
      ? "min-h-[200px] pb-4 pt-4"
      : hasIntegratedOverlayChrome
        ? "min-h-[246px]"
        : "min-h-[276px] pb-4 pt-4"
    : hasRunningLinkedTasks
      ? hasIntegratedOverlayChrome
        ? "h-[276px]"
        : "h-[252px]"
      : baseStageHeightClass;
  const runningGlowHeightClass = useAutoHeightRunningLayout
    ? "bottom-4"
    : hasRunningLinkedTasks
      ? hasIntegratedOverlayChrome
        ? "h-[240px]"
        : "h-[215px]"
      : baseGlowHeightClass;
  const runningCardHeightClass = useAutoHeightRunningLayout
    ? useAutoHeightConfigLayout
      ? "min-h-[169px]"
      : "min-h-[246px]"
    : hasRunningLinkedTasks
      ? hasIntegratedOverlayChrome
        ? "h-[246px]"
        : "h-[221px]"
      : baseCardHeightClass;
  const showOverlaySurfaceBackdropGlow = !hasIntegratedOverlayChrome;
  const runningCardLayoutClass = useAutoHeightRunningLayout
    ? (hasIntegratedOverlayChrome ? "relative w-full" : "relative mx-4")
    : (hasIntegratedOverlayChrome ? "absolute inset-x-0 top-0" : "absolute left-4 right-4 top-4");
  const overlaySurfacePressedClass = overlayChrome?.surfacePressed
    ? "ring-1 ring-inset ring-[#FDE4DE]/60"
    : "";

  const isEndActionDisabled = feedbackInProgress && feedbackOpen;
  const endActionAriaLabel = feedbackInProgress
    ? "反馈中（Feedback in progress）"
    : "停止（Stop）";
  const endActionTitle = feedbackInProgress ? "反馈中" : "停止";
  const endActionButtonClass = feedbackInProgress
    ? "h-11 w-11 rounded-[12px] bg-brand p-0 text-white hover:bg-brand/90 hover:text-white"
    : "h-11 w-11 rounded-[12px] bg-[#C75B3A] p-0 text-white hover:bg-[#B24D2F] hover:text-white";
  const endActionIcon = feedbackInProgress ? (
    <NotepadText size={18} className="text-white" />
  ) : (
    <Square size={18} />
  );
  const renderRunningNameControl = (variant: "default" | "overlay") => {
    const isOverlayVariant = variant === "overlay";
    if (running?.name.readOnly) {
      return (
        <span
          data-testid="new-focus-running-name-display"
          className={`block min-w-0 max-w-full truncate rounded-[8px] text-left font-semibold ${
            isOverlayVariant
              ? "pt-0.5 text-[18px] leading-[1.35] text-[#F5EDE7]"
              : `text-[20px] leading-[1.4] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#1C1917] dark:text-[#FAFAF9]"}`
          }`}
        >
          {runningNameDisplayText}
        </span>
      );
    }
    if (isRunningNameEditing) {
      return (
        <Input
          ref={runningNameInputRef}
          data-testid="new-focus-running-name-input"
          value={runningNameDraft}
          disabled={isRunningNameSaving}
          onChange={(event) => bindings.runningName?.onChange?.(event)}
          onFocus={bindings.runningName?.onFocus}
          onKeyDown={handleRunningNameKeyDown}
          onBlur={bindings.runningName?.onBlur}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label="编辑时间块名称（Edit time block name）"
          className={`h-8 w-full min-w-0 border-[#E7E5E4]/80 bg-white/70 px-2 text-left font-semibold shadow-none focus-visible:ring-1 focus-visible:ring-[#C75B3A] dark:border-[#FFFFFF20] dark:bg-[#FFFFFF12] ${
            isOverlayVariant
              ? "mt-0.5 text-[18px] leading-[1.25] text-[#F5EDE7]"
              : "text-[20px] leading-[1.25] text-[#1C1917] dark:text-[#FAFAF9]"
          }`}
        />
      );
    }

    return (
      <button
        type="button"
        data-testid="new-focus-running-name-display"
        onClick={handleBeginRunningNameEdit}
        onMouseDown={(event) => event.stopPropagation()}
        disabled={feedbackInProgress || isRunningNameSaving}
        title="编辑时间块名称"
        className={`block min-w-0 max-w-full truncate rounded-[8px] text-left font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C75B3A]/45 disabled:cursor-default disabled:opacity-100 ${
          isOverlayVariant
            ? "pt-0.5 text-[18px] leading-[1.35] text-[#F5EDE7] hover:text-white"
            : `text-[20px] leading-[1.4] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#1C1917] hover:text-[#B24D2F] dark:text-[#FAFAF9] dark:hover:text-[#F5B097]"}`
        }`}
      >
        {runningNameDisplayText}
      </button>
    );
  };

  return (
    <div
      className={
        isOverlaySurface ? "bg-transparent" : "bg-[#FAF7F5] dark:bg-[#0C0A09]"
      }
      data-testid="new-focus-timer-widget"
    >
      {uiState === "idle" && (
        <section className={isOverlaySurface ? "pt-0" : "pt-[10px]"}>
          <div
            className="relative mx-auto h-[104px] w-full max-w-[390px]"
            data-testid="new-focus-state-idle"
          >
            <div
              className={`absolute left-1/2 top-[18px] h-[74px] w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? "bg-[rgba(12,10,9,0.24)]"
                  : "bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
              }`}
              aria-hidden
            />

            <button
              type="button"
              data-testid="new-focus-idle-card"
              onClick={enterConfigState}
              aria-expanded="false"
              aria-controls="new-focus-config-panel"
              aria-label="展开专注配置（Expand focus configuration）"
              className={`absolute left-4 right-4 top-4 flex h-[68px] items-center justify-between rounded-[24px] px-5 py-[18px] text-left backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? "border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]"
                  : "border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
              }`}
            >
              <div className="mr-3 flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                  <Target size={20} />
                </div>
                <div className="min-w-0">
                  <p
                    className={`truncate text-[16px] font-semibold leading-[1.4] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#1C1917] dark:text-[#FAFAF9]"}`}
                  >
                    点击开启时间块
                  </p>
                  <p
                    className={`truncate text-[12px] leading-[1.4] ${isOverlaySurface ? "text-[#D6C2B8]" : "text-[#78716C]"}`}
                  >
                    配置时间块，开启新计时
                  </p>
                </div>
              </div>
              <ChevronRight
                size={20}
                className="shrink-0 text-[#C75B3A] dark:text-[#E8734E]"
              />
            </button>
          </div>
        </section>
      )}

      {uiState === "config" && (
        <section className={isOverlaySurface ? "pt-0" : "pt-[10px]"}>
          <div
            className={`relative mx-auto w-full max-w-[390px] ${baseStageHeightClass}`}
            data-testid="new-focus-state-config"
          >
            <div
              className={`absolute left-1/2 top-[20px] ${baseGlowHeightClass} w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                isOverlaySurface
                  ? "bg-[rgba(12,10,9,0.24)]"
                  : "bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
              }`}
              aria-hidden
            />

            <div
              id="new-focus-config-panel"
              className={`${useAutoHeightConfigLayout ? "relative mx-4" : "absolute left-4 right-4 top-4"} flex ${baseCardHeightClass} flex-col gap-3 ${isOverlaySurface ? "overflow-y-auto" : ""} rounded-[24px] px-[18px] py-4 backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? "border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]"
                  : "border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
              }`}
            >
              <div className="flex items-center gap-[10px]">
                <button
                  type="button"
                  data-testid="new-focus-config-collapse-button"
                  aria-expanded="true"
                  aria-controls="new-focus-config-panel"
                  aria-label="收起专注配置（Collapse focus configuration）"
                  onClick={handleCollapseToIdle}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E] transition-transform active:scale-95"
                >
                  <Target size={20} />
                </button>
                <Textarea
                  ref={taskInputRef}
                  data-testid="new-focus-task-input"
                  value={taskNameDraft}
                  onChange={(event) => bindings.configName?.onChange?.(event)}
                  onFocus={bindings.configName?.onFocus}
                  onBlur={bindings.configName?.onBlur}
                  onKeyDown={handleTaskInputKeyDown}
                  placeholder="输入时间块名称..."
                  rows={1}
                  className="max-h-24 border-[#E7E5E4]/80 dark:border-[#FFFFFF20] bg-white/60 dark:bg-[#FFFFFF10] text-sm dark:text-[#FAFAF9]"
                />
              </div>

              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />

              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">
                  预期时长
                </span>
                <div
                  className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
                  data-testid="new-focus-expected-time-row"
                  onKeyDown={handleExpectedTimeKeyDown}
                >
                  <div
                    data-testid="new-focus-expected-active-indicator"
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/5 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
                    style={{
                      transform: `translateX(${activeExpectedIndex * 100}%)`,
                    }}
                  />
                  <div className="relative z-10 grid min-w-0 grid-cols-5 gap-0">
                    <button
                      type="button"
                      data-testid="new-focus-expected-countup"
                      onClick={() => actions.selectTiming("countup")}
                      className={expectedOptionClass(timerMode === "countup")}
                    >
                      正计时
                    </button>

                    {PRESET_COUNTDOWN_MINUTES.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        data-testid={`new-focus-expected-${minutes}`}
                        onClick={() => actions.selectTiming("countdown", minutes)}
                        className={expectedOptionClass(
                          timerMode === "countdown" &&
                            countdownMinutes === minutes,
                        )}
                      >
                        {minutes}m
                      </button>
                    ))}

                    {isCustomDurationEditing ? (
                      <Input
                        ref={customDurationInputRef}
                        data-testid="new-focus-expected-custom-input"
                        value={customDurationDraft}
                        onChange={(event) => bindings.customMinutes?.onChange?.(event)}
                        onFocus={bindings.customMinutes?.onFocus}
                        onBlur={bindings.customMinutes?.onBlur}
                        onKeyDown={handleCustomDurationKeyDown}
                        aria-label="自定义倒计时分钟（Custom countdown minutes）"
                        placeholder="分钟"
                        className="relative z-10 h-8 w-full border-transparent bg-transparent px-[6px] text-center text-[12px] font-semibold leading-none text-[#1C1917] shadow-none outline-none ring-0 focus-visible:ring-0 dark:text-[#FAFAF9]"
                      />
                    ) : (
                      <button
                        type="button"
                        data-testid="new-focus-expected-custom-trigger"
                        onClick={handleOpenCustomDurationEditor}
                        className={`relative z-10 flex h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded-[8px] px-[8px] text-[12px] transition-colors duration-200 ${
                          isCustomDurationSelected
                            ? "font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
                            : "text-[#C75B3A] hover:text-[#B24D2F]"
                        }`}
                        aria-label="自定义倒计时（Custom countdown）"
                      >
                        <ChevronDown
                          size={12}
                          className="transition-transform"
                        />
                        {customDurationTriggerText}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <Button
                type="button"
                data-testid="new-focus-start-button"
                onClick={() => {
                  void handleStart();
                }}
                className="h-10 w-full rounded-[12px] bg-[#C75B3A] text-[14px] font-medium text-white hover:bg-[#B24D2F] dark:bg-[#C75B3A] dark:hover:bg-[#B24D2F]"
              >
                <Play size={16} className="mr-2" />
                开始
              </Button>
            </div>
          </div>
        </section>
      )}

      {uiState === "running" && (
        <section
          className={isOverlaySurface ? "pt-0" : "pt-[10px]"}
          data-testid="new-focus-state-running"
        >
          <div
            className={`relative mx-auto w-full max-w-[390px] ${runningStageHeightClass}`}
          >
            {showOverlaySurfaceBackdropGlow ? (
              <div
                className={`absolute left-1/2 top-[20px] ${runningGlowHeightClass} w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] blur-[8px] ${
                  isOverlaySurface
                    ? "bg-[rgba(12,10,9,0.24)]"
                    : "bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
                }`}
                aria-hidden
              />
            ) : null}
            <div
              ref={overlayChrome?.onSurfaceMount}
              data-testid="new-focus-running-task-card"
              data-overlay-visible-surface={hasIntegratedOverlayChrome ? "true" : undefined}
              onMouseDownCapture={overlayChrome?.onSurfaceMouseDownCapture}
              className={`${runningCardLayoutClass} flex ${runningCardHeightClass} flex-col gap-3 rounded-[24px] px-5 py-4 backdrop-blur-[24px] ${glassCardShadowClass()} ${
                isOverlaySurface
                  ? "border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9]"
                  : "border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
              } ${overlaySurfacePressedClass}`}
            >
              {overlayChrome ? (
                <div
                  className="flex min-w-0 items-start justify-between gap-3"
                  data-testid="new-focus-overlay-running-header"
                >
                  <div
                    data-testid="new-focus-overlay-drag-handle"
                    data-tauri-drag-region
                    title="按住这里拖动窗口"
                    className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                  >
                    <p
                      className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6C2B8]"
                      data-tauri-drag-region
                    >
                      {overlayChrome.statusLabel}
                    </p>
                    {renderRunningNameControl("overlay")}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {hasFocusBgmConfigured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid="new-focus-bgm-toggle-button"
                        aria-label={focusBgmToggleAriaLabel}
                        className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                        onClick={actions.openBgm}
                      >
                        {focusBgmToggleIcon}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={overlayChrome.onCollapse}
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
                      onClick={overlayChrome.onReturnToMain}
                      aria-label="显示主程序"
                      title="显示主程序"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                    >
                      <ArrowUpRight size={15} />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                      <Target size={20} />
                    </div>
                    {renderRunningNameControl("default")}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {!isOverlaySurface ? slots.keepAwake : null}
                    {hasFocusBgmConfigured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid="new-focus-bgm-toggle-button"
                        aria-label={focusBgmToggleAriaLabel}
                        className={`h-9 w-9 rounded-[10px] p-0 ${
                          isOverlaySurface
                            ? "border border-white/10 bg-white/8 text-[#E7D7CF] hover:bg-white/15"
                            : "border border-[#E7E5E4] bg-white/50 text-[#C75B3A] hover:bg-white/70 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF10] dark:text-[#E8734E]"
                        }`}
                        onClick={actions.openBgm}
                      >
                        {focusBgmToggleIcon}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />
              <div className="flex items-center justify-between px-1 pt-1">
                <Button
                  type="button"
                  data-testid="new-focus-pause-resume-button"
                  aria-label={isPaused ? "继续（Resume）" : "暂停（Pause）"}
                  disabled={feedbackInProgress}
                  onClick={() => {
                    void handlePauseOrResume();
                  }}
                  className={
                    isPaused
                      ? "h-11 w-11 rounded-[12px] bg-[#16A34A] p-0 text-white hover:bg-[#15803D]"
                      : "h-11 w-11 rounded-[12px] bg-warning p-0 text-white hover:bg-warning/90 hover:text-white"
                  }
                >
                  {isPaused ? <Play size={18} /> : <Pause size={18} />}
                </Button>
                <div className="flex min-w-0 flex-col items-center gap-1 px-2">
                  <span
                    className={`font-mono text-[40px] font-normal leading-[1.1] tracking-[2px] ${
                      isCountdownWarning
                        ? "text-[#C75B3A]"
                        : "text-[#1C1917] dark:text-[#FAFAF9]"
                    }`}
                    data-testid="new-focus-running-clock"
                  >
                    {clockText}
                  </span>
                  {countdownEndTimeDisplay && (
                    <span
                      data-testid="new-focus-end-time"
                      className="max-w-full truncate text-[12px] leading-[1.2] text-[#8C7D78] dark:text-[#A8A29E]"
                    >
                      {countdownEndTimeDisplay.text}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  data-testid="new-focus-end-button"
                  aria-label={endActionAriaLabel}
                  title={endActionTitle}
                  disabled={isEndActionDisabled}
                  onClick={handleOpenEndDialog}
                  className={endActionButtonClass}
                >
                  {endActionIcon}
                </Button>
              </div>
              {hasRunningLinkedTasks && (
                <>
                  <div className="h-px w-full bg-[#D4785F24] dark:bg-[#D4785F18]" />
                  <div
                    data-testid="new-focus-running-linked-tasks"
                    className="min-h-0 px-1"
                  >
                    <p
                      className={`pb-1 text-[11px] font-medium ${isOverlaySurface ? "text-[#D6C2B8]" : "text-[#78716C] dark:text-[#A8A29E]"}`}
                    >
                      关联任务
                    </p>
                    <ul
                      className={`list-disc space-y-1 pl-4 text-[12px] leading-[1.35] ${isOverlaySurface ? "text-[#F5EDE7]" : "text-[#44403C] dark:text-[#E7E5E4]"}`}
                    >
                      {linkedTasks.map((task) => (
                        <li
                          key={task.id}
                          data-testid={`new-focus-running-linked-task-${task.id}`}
                          className={
                            useAutoHeightRunningLayout || !isOverlaySurface
                              ? "break-words whitespace-normal marker:text-[#C75B3A]"
                              : "truncate marker:text-[#C75B3A]"
                          }
                          title={task.title}
                        >
                          {task.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {slots.dialogs}
    </div>
  );
}
