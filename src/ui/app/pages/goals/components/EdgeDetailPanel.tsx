import { useEffect, useState } from 'react';
import type { GoalDisplayStatus, TaskEdge, TaskEdgeStatus } from '../goal-types';
import { DetailPanelShell } from './DetailPanelShell';

interface EdgeDetailPanelProps {
  edge: TaskEdge;
  status: TaskEdgeStatus;
  targetStatus: GoalDisplayStatus;
  sourceLabel: string;
  targetLabel: string;
  onClose: () => void;
  onUpdate: (patch: { title?: string; description?: string; taskNodeRef?: string }) => boolean;
  onJumpNode: (nodeId: string) => void;
  onSetOverride: (status: TaskEdgeStatus) => void;
  onClearOverride: () => void;
}

export function EdgeDetailPanel({
  edge,
  status,
  targetStatus,
  sourceLabel,
  targetLabel,
  onClose,
  onUpdate,
  onJumpNode,
  onSetOverride,
  onClearOverride,
}: EdgeDetailPanelProps) {
  const [title, setTitle] = useState(edge.title);
  const [description, setDescription] = useState(edge.description);
  const [taskNodeRef, setTaskNodeRef] = useState(edge.taskNodeRef ?? '');
  const [developerOpen, setDeveloperOpen] = useState(false);
  const frozen = targetStatus === 'completed';

  useEffect(() => {
    setTitle(edge.title);
    setDescription(edge.description);
    setTaskNodeRef(edge.taskNodeRef ?? '');
    setDeveloperOpen(false);
  }, [edge]);

  return (
    <DetailPanelShell title={edge.title || '待定义'} subtitle="路径详情" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
            {status}
          </span>
          <span className="rounded-full bg-[#FAF7F5] px-2 py-0.5 text-[10px] font-medium text-[#A8A29E] dark:bg-[#120F0D] dark:text-[#A8A29E]">
            target {targetStatus}
          </span>
        </div>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">标题</label>
          <input
            value={title}
            disabled={frozen}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title !== edge.title && !onUpdate({ title })) {
                setTitle(edge.title);
              }
            }}
            className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">描述</label>
          <textarea
            value={description}
            disabled={frozen}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== edge.description && !onUpdate({ description })) {
                setDescription(edge.description);
              }
            }}
            className="min-h-[100px] w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">任务绑定</label>
          <input
            value={taskNodeRef}
            disabled={frozen}
            onChange={(event) => setTaskNodeRef(event.target.value)}
            onBlur={() => {
              const nextValue = taskNodeRef.trim();
              if (nextValue !== (edge.taskNodeRef ?? '')) {
                if (!onUpdate({ taskNodeRef: nextValue || undefined })) {
                  setTaskNodeRef(edge.taskNodeRef ?? '');
                }
              }
            }}
            placeholder="TaskNode ID"
            className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
          />
        </section>

        <section className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onJumpNode(edge.source)} className="rounded-2xl border border-[#E7E5E4] px-3 py-2 text-left text-sm dark:border-[#3F3F46]">
            {sourceLabel}
          </button>
          <button type="button" onClick={() => onJumpNode(edge.target)} className="rounded-2xl border border-[#E7E5E4] px-3 py-2 text-left text-sm dark:border-[#3F3F46]">
            {targetLabel}
          </button>
        </section>

        <section className="rounded-2xl border border-amber-300/50 bg-amber-50/70 p-3 dark:bg-amber-950/20">
          <button
            type="button"
            aria-label="⚙ 开发者"
            onClick={() => setDeveloperOpen((current) => !current)}
            className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300"
          >
            <span>⚙ 开发者</span>
            <span>{developerOpen ? '收起' : '展开'}</span>
          </button>
          {developerOpen ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {(['pending', 'in_progress', 'suspended', 'completed', 'cancelled'] as TaskEdgeStatus[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSetOverride(item)}
                  className="rounded-full border border-amber-300 px-2 py-1 text-[11px] text-amber-900 dark:text-amber-100"
                >
                  {item}
                </button>
              ))}
              <button type="button" onClick={onClearOverride} className="rounded-full border border-stone-300 px-2 py-1 text-[11px]">
                清除覆盖
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </DetailPanelShell>
  );
}
