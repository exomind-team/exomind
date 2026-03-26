interface CancelGoalDialogProps {
  open: boolean;
  goalTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CancelGoalDialog({ open, goalTitle, onCancel, onConfirm }: CancelGoalDialogProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-5 shadow-xl dark:bg-[#1C1917]">
        <h3 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">确认取消目标</h3>
        <p className="mt-2 text-sm text-[#57534E] dark:text-[#D6D3D1]">
          目标“{goalTitle || '待命名'}”会被标记为已取消，并默认从画布中隐藏。
        </p>
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
