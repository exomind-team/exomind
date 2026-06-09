interface CancelGoalDialogProps {
  open: boolean;
  goalTitle: string;
  cascadeInTasks: boolean;
  cascadeOutTasks: boolean;
  onCascadeInTasksChange: (value: boolean) => void;
  onCascadeOutTasksChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CancelGoalDialog({
  open,
  goalTitle,
  cascadeInTasks,
  cascadeOutTasks,
  onCascadeInTasksChange,
  onCascadeOutTasksChange,
  onCancel,
  onConfirm,
}: CancelGoalDialogProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-5 shadow-xl dark:bg-[#1C1917]">
        <h3 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">确认取消目标</h3>
        <p className="mt-2 text-sm text-[#57534E] dark:text-[#D6D3D1]">
          目标“{goalTitle || '待命名'}”会被标记为已取消，并默认从画布中隐藏。
        </p>
        <div className="mt-4 space-y-2 rounded-[24px] border border-[#F3E8E2] bg-[#FAF7F5] p-3 text-sm text-[#57534E] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#D6D3D1]">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={cascadeInTasks}
              onChange={(event) => onCascadeInTasksChange(event.target.checked)}
              className="mt-0.5"
            />
            <span>同时取消入边关联的任务（达成手段）</span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={cascadeOutTasks}
              onChange={(event) => onCascadeOutTasksChange(event.target.checked)}
              className="mt-0.5"
            />
            <span>同时取消出边关联的任务（后续路径）</span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full border border-[#E7E5E4] px-4 py-2 text-sm">
            返回
          </button>
          <button type="button" onClick={onConfirm} className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white">
            确认取消
          </button>
        </div>
      </div>
    </div>
  );
}
