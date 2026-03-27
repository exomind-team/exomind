import { useEffect, useMemo, useState } from 'react';
import { getTodayPlannerService } from '@/lib/services';
import type { RhythmPresetKey, TodayPlannerSegment, TodayPlannerSnapshot, TodayPlannerWindow } from '@/lib/types/event';
import { PrestartTaskSelectionList, usePrestartSelectableTasks } from './prestart-task-selection';

const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;
const SLOT_HEIGHT = 24;
const SLOT_COUNT = (24 * 60) / SLOT_MINUTES;

const RHYTHM_OPTIONS: Array<{ key: RhythmPresetKey; label: string }> = [
  { key: 'pomodoro_25_5', label: '25 / 5 · Pomodoro' },
  { key: 'focus_45_10', label: '45 / 10 · Focus' },
  { key: 'focus_45_15', label: '45 / 15 · Long Break' },
];

interface SlotRange {
  startIndex: number;
  endIndex: number;
}

interface DraftState extends SlotRange {
  title: string;
  rhythmPresetKey: RhythmPresetKey;
}

interface NowTodayPlannerTimelineProps {
  dateKey: string;
  snapshot: TodayPlannerSnapshot | null;
  loading: boolean;
  error: string | null;
  setError(message: string | null): void;
  refreshPlanner(): Promise<void>;
  refreshHistory(forceRefreshTasks?: boolean): Promise<void>;
}

function normalizeRange(startIndex: number, endIndex: number): SlotRange {
  return { startIndex: Math.min(startIndex, endIndex), endIndex: Math.max(startIndex, endIndex) };
}

function buildTs(dateKey: string, timeValue: string): number {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  const [hours, minutes] = timeValue.split(':').map((part) => Number.parseInt(part, 10));
  return new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0).getTime();
}

function dayStart(dateKey: string): number {
  return buildTs(dateKey, '00:00');
}

function resolveActualEndAt(dateKey: string, segment: TodayPlannerSegment, timeInput: string): number {
  const resolved = buildTs(dateKey, timeInput);
  const dayEnd = dayStart(dateKey) + 86_400_000;
  if (segment.plannedEndAt >= dayEnd && resolved <= segment.plannedStartAt) {
    return resolved + 86_400_000;
  }
  return resolved;
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function timeValue(timestamp: number): string {
  const date = new Date(timestamp);
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function selectionRange(dateKey: string, range: SlotRange): { startAt: number; endAt: number } {
  const start = dayStart(dateKey);
  return {
    startAt: start + range.startIndex * SLOT_MS,
    endAt: start + (range.endIndex + 1) * SLOT_MS,
  };
}

function rangeLabel(startAt: number, endAt: number): string {
  return `${clock(startAt)} - ${clock(endAt)} · ${Math.max(1, Math.round((endAt - startAt) / 60_000))} 分钟`;
}

function topFor(dateKey: string, timestamp: number): number {
  return ((timestamp - dayStart(dateKey)) / SLOT_MS) * SLOT_HEIGHT;
}

function heightFor(window: TodayPlannerWindow): number {
  return ((window.plannedEndAt - window.plannedStartAt) / SLOT_MS) * SLOT_HEIGHT;
}

function segmentTone(segment: TodayPlannerSegment, selected: boolean): string {
  if (segment.kind === 'break') return 'border-dashed border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200';
  if (segment.status === 'active') return 'border-orange-600 bg-orange-600 text-white';
  if (segment.status === 'completed') return 'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100';
  return `${selected ? 'ring-2 ring-stone-950 dark:ring-stone-50 ' : ''}border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-[#2A231B] dark:text-orange-200`;
}

export function NowTodayPlannerTimeline({
  dateKey,
  snapshot,
  loading,
  error,
  setError,
  refreshPlanner,
  refreshHistory,
}: NowTodayPlannerTimelineProps) {
  const [dragRange, setDragRange] = useState<SlotRange | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorTaskIds, setEditorTaskIds] = useState<string[]>([]);
  const [actualEndTime, setActualEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const selectableTasks = usePrestartSelectableTasks();

  useEffect(() => {
    if (!dragRange) return;
    const handleMouseUp = () => {
      const next = normalizeRange(dragRange.startIndex, dragRange.endIndex);
      setDraft({ ...next, title: '', rhythmPresetKey: 'pomodoro_25_5' });
      setDragRange(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragRange]);

  const slots = useMemo(() => Array.from({ length: SLOT_COUNT }, (_, index) => {
    const minutes = index * SLOT_MINUTES;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return { index, label: `${`${hours}`.padStart(2, '0')}:${`${mins}`.padStart(2, '0')}`, isHour: mins === 0 };
  }), []);

  const windows = useMemo(
    () => [...(snapshot?.windows ?? [])].sort((left, right) => left.plannedStartAt - right.plannedStartAt),
    [snapshot],
  );

  const selectedContext = useMemo(() => {
    for (const window of windows) {
      const segment = window.segments.find((candidate) => candidate.id === selectedSegmentId);
      if (segment) return { window, segment };
    }
    return null;
  }, [selectedSegmentId, windows]);

  const selectedWork = selectedContext?.segment.kind === 'work' ? selectedContext : null;

  useEffect(() => {
    if (!selectedWork) {
      setEditorTitle('');
      setEditorTaskIds([]);
      setActualEndTime('');
      return;
    }
    setEditorTitle(selectedWork.segment.title);
    setEditorTaskIds(selectedWork.segment.linkedTaskIds);
    setActualEndTime(timeValue(selectedWork.segment.plannedEndAt));
  }, [selectedWork]);

  const preview = draft ?? (dragRange ? normalizeRange(dragRange.startIndex, dragRange.endIndex) : null);
  const previewRect = preview ? (() => {
    const { startAt, endAt } = selectionRange(dateKey, preview);
    return { top: topFor(dateKey, startAt), height: ((endAt - startAt) / SLOT_MS) * SLOT_HEIGHT };
  })() : null;

  async function createWindow(): Promise<void> {
    if (!draft) return;
    const { startAt, endAt } = selectionRange(dateKey, draft);
    setSubmitting(true);
    setError(null);
    try {
      await getTodayPlannerService().createSchedulingWindow({
        date: dateKey,
        title: draft.title.trim() || undefined,
        plannedStartAt: startAt,
        plannedEndAt: endAt,
        rhythmPresetKey: draft.rhythmPresetKey,
      });
      await refreshPlanner();
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建可调度区间失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSegment(): Promise<void> {
    if (!selectedWork) return;
    setSubmitting(true);
    setError(null);
    try {
      await getTodayPlannerService().updatePlannedSegment(selectedWork.segment.id, {
        ...(editorTitle.trim() && editorTitle.trim() !== selectedWork.segment.title ? { title: editorTitle.trim() } : {}),
        linkedTaskIds: editorTaskIds,
      });
      await refreshPlanner();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存工作片段失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function startSegment(): Promise<void> {
    if (!selectedWork) return;
    setSubmitting(true);
    setError(null);
    try {
      await getTodayPlannerService().startWorkSegment(selectedWork.segment.id);
      await Promise.all([refreshPlanner(), refreshHistory(true)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开始工作片段失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function reflowWindow(): Promise<void> {
    if (!selectedWork) return;
    setSubmitting(true);
    setError(null);
    try {
      await getTodayPlannerService().reflowSchedulingWindow(selectedWork.window.id, {
        anchorSegmentId: selectedWork.segment.id,
        actualEndAt: resolveActualEndAt(dateKey, selectedWork.segment, actualEndTime),
      });
      await refreshPlanner();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重算当前区间失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#E7E5E4] bg-white/90 p-4 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">Today Planner / 今日计划</p>
        <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">拖出可调度区间，再自动切成工作片段与休息窗。</p>
      </div>
      {error ? <p className="mt-3 text-xs text-[#C75B3A]" role="alert">{error}</p> : null}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-[#E7E5E4] bg-[#FCFBFA] p-3 dark:border-[#292524] dark:bg-[#120F0D]">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">Timeline / 时间线</p>
              <p className="mt-1 text-sm text-[#57534E] dark:text-[#D6D3D1]">15 分钟一格，拖拽创建可调度区间。</p>
            </div>
            <span className="rounded-full bg-[#F5F0ED] px-3 py-1 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {loading ? '同步中...' : `${windows.length} 个区间`}
            </span>
          </div>
          <div className="max-h-[720px] overflow-y-auto rounded-2xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
            <div className="relative" style={{ height: `${SLOT_COUNT * SLOT_HEIGHT}px` }}>
              {slots.map((slot) => (
                <div
                  key={slot.label}
                  data-testid={`planner-slot-${slot.label}`}
                  className="absolute inset-x-0 select-none"
                  style={{ top: `${slot.index * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px` }}
                  onMouseDown={() => { setSelectedSegmentId(null); setDraft(null); setDragRange({ startIndex: slot.index, endIndex: slot.index }); }}
                  onMouseEnter={() => setDragRange((current) => current ? { ...current, endIndex: slot.index } : current)}
                  onMouseUp={() => {
                    if (!dragRange) return;
                    setDraft({ ...normalizeRange(dragRange.startIndex, slot.index), title: '', rhythmPresetKey: 'pomodoro_25_5' });
                    setDragRange(null);
                  }}
                >
                  <div className="flex h-full">
                    <div className="w-16 px-3 pt-1 text-[10px] text-[#A8A29E]">{slot.isHour ? slot.label : ''}</div>
                    <div className={`h-full flex-1 border-t ${slot.isHour ? 'border-[#D6D3D1] dark:border-[#44403C]' : 'border-[#F5F0ED] dark:border-[#292524]'}`} />
                  </div>
                </div>
              ))}
              {previewRect ? (
                <div
                  className="pointer-events-none absolute left-16 right-3 z-[5] rounded-2xl border border-dashed border-[#C75B3A] bg-[#FFF7ED]/70"
                  data-testid="today-planner-selection-preview"
                  style={previewRect}
                />
              ) : null}
              {windows.map((window) => (
                <div
                  key={window.id}
                  data-testid={`planner-window-${window.id}`}
                  className="absolute left-16 right-3 z-10 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white shadow-sm dark:border-[#44403C] dark:bg-[#1F1B18]"
                  style={{ top: `${topFor(dateKey, window.plannedStartAt)}px`, height: `${heightFor(window)}px` }}
                >
                  <div className="pointer-events-none absolute left-2 right-2 top-2 z-20 flex items-center justify-between gap-2">
                    <div className="truncate rounded-full bg-white/80 px-2 py-1 text-[10px] font-medium text-[#57534E] shadow-sm dark:bg-[#120F0D]/80 dark:text-[#E7E5E4]">
                      {window.title?.trim() || '可调度区间'}
                    </div>
                    <div className="rounded-full bg-[#1C1917]/80 px-2 py-1 text-[10px] text-white dark:bg-[#FAFAF9]/80 dark:text-[#1C1917]">
                      {window.rhythmPreset.label}
                    </div>
                  </div>
                  <div className="flex h-full flex-col">
                    {window.segments.map((segment) => {
                      const flexValue = Math.max(1, segment.plannedEndAt - segment.plannedStartAt);
                      const selected = selectedSegmentId === segment.id;
                      return segment.kind === 'work' ? (
                        <button
                          key={segment.id}
                          type="button"
                          data-testid={`planner-segment-${segment.id}`}
                          aria-label={`选择工作片段：${segment.title}`}
                          onClick={() => setSelectedSegmentId(segment.id)}
                          className={`relative flex min-h-0 flex-col items-start justify-end overflow-hidden border px-3 py-2 text-left transition-colors ${segmentTone(segment, selected)}`}
                          style={{ flex: `${flexValue} 1 0` }}
                        >
                          <span className="text-[11px] font-semibold leading-tight">{segment.title}</span>
                          <span className="mt-1 text-[10px] opacity-80">
                            {clock(segment.plannedStartAt)} - {clock(segment.plannedEndAt)}
                            {segment.linkedTaskIds.length > 0 ? ` · ${segment.linkedTaskIds.length} 个任务` : ''}
                          </span>
                        </button>
                      ) : (
                        <div
                          key={segment.id}
                          className={`relative flex min-h-0 items-center border px-3 py-1 text-[10px] ${segmentTone(segment, false)}`}
                          style={{ flex: `${flexValue} 1 0` }}
                        >
                          <span className="truncate">{segment.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="rounded-3xl border border-[#E7E5E4] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
          {draft ? (
            <div data-testid="today-planner-window-draft" className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">Draft / 区间草稿</p>
                <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                  {(() => {
                    const { startAt, endAt } = selectionRange(dateKey, draft);
                    return rangeLabel(startAt, endAt);
                  })()}
                </p>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">创建的是“可调度区间”，内部会自动切成工作和休息。</p>
              </div>
              <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
                <span>区间标题</span>
                <input
                  aria-label="区间标题"
                  value={draft.title}
                  onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
                  className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917]"
                  placeholder="例如：上午深度工作"
                />
              </label>
              <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
                <span>节奏预设</span>
                <select
                  aria-label="节奏预设"
                  value={draft.rhythmPresetKey}
                  onChange={(event) => setDraft((current) => current ? { ...current, rhythmPresetKey: event.target.value as RhythmPresetKey } : current)}
                  className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917]"
                >
                  {RHYTHM_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={submitting} onClick={() => void createWindow()} className="rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white hover:bg-[#B14D2F] disabled:cursor-not-allowed disabled:opacity-60">
                  创建可调度区间
                </button>
                <button type="button" onClick={() => setDraft(null)} className="rounded-full border border-[#E7E5E4] px-4 py-2 text-sm text-[#57534E] hover:bg-[#F5F0ED] dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]">
                  取消
                </button>
              </div>
            </div>
          ) : selectedWork ? (
            <div data-testid="planner-segment-inspector" className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">Inspector / 工作片段</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{selectedWork.segment.title}</p>
                  <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                    {selectedWork.segment.status === 'active' ? '进行中' : selectedWork.segment.status === 'completed' ? '已完成' : '待开始'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{rangeLabel(selectedWork.segment.plannedStartAt, selectedWork.segment.plannedEndAt)}</p>
              </div>
              <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
                <span>工作标题</span>
                <input
                  aria-label="工作标题"
                  value={editorTitle}
                  onChange={(event) => setEditorTitle(event.target.value)}
                  className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917]"
                />
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">Tasks / 关联任务</p>
                  <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">只有工作片段可以挂任务</span>
                </div>
                <PrestartTaskSelectionList
                  tasks={selectableTasks}
                  selectedTaskIds={editorTaskIds}
                  onSelectedTaskIdsChange={setEditorTaskIds}
                  listTestId="planner-segment-task-list"
                  itemTestIdPrefix="planner-segment-task-"
                  emptyLabel="当前没有可关联的任务。"
                  maxVisibleTasks={10}
                  overflowSelectLabel="更多任务"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">Reflow / 当前区间重算</p>
                <div className="flex gap-2">
                  <input
                    aria-label="实际结束时间"
                    type="time"
                    value={actualEndTime}
                    onChange={(event) => setActualEndTime(event.target.value)}
                    className="min-w-0 flex-1 rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917]"
                  />
                  <button type="button" disabled={submitting} onClick={() => void reflowWindow()} className="rounded-full border border-[#E7E5E4] px-3 py-2 text-xs text-[#57534E] hover:bg-[#F5F0ED] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]">
                    重算当前区间
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={submitting} onClick={() => void saveSegment()} className="rounded-full border border-[#E7E5E4] px-4 py-2 text-sm text-[#57534E] hover:bg-[#F5F0ED] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]">
                  保存工作片段
                </button>
                <button type="button" disabled={submitting || selectedWork.segment.status === 'active'} onClick={() => void startSegment()} className="rounded-full bg-[#1C1917] px-4 py-2 text-sm font-medium text-white hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#FAFAF9] dark:text-[#1C1917] dark:hover:bg-[#E7E5E4]">
                  开始这个工作片段
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#E7E5E4] bg-white/70 p-4 text-sm text-[#57534E] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
              <p>1. 在左侧时间线上拖出一个可调度区间。</p>
              <p className="mt-2">2. 选节奏预设，让系统自动切分工作片段和休息窗。</p>
              <p className="mt-2">3. 点击工作片段，挂任务、开始执行，必要时只重算当前区间。</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
