import { Crosshair, LocateFixed } from 'lucide-react';

interface TaskDagControlPanelProps {
  onFitView: () => void;
  onJumpToCurrentRoot?: () => void;
  hasCurrentRoot: boolean;
}

export function TaskDagControlPanel({ onFitView, onJumpToCurrentRoot, hasCurrentRoot }: TaskDagControlPanelProps) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        data-testid="task-dag-fit-view"
        onClick={onFitView}
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur hover:bg-white dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:bg-[#292524]"
      >
        <Crosshair size={12} />
        适配视口
      </button>
      {hasCurrentRoot && onJumpToCurrentRoot && (
        <button
          type="button"
          data-testid="task-dag-jump-to-root"
          onClick={onJumpToCurrentRoot}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur hover:bg-white dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:bg-[#292524]"
        >
          <LocateFixed size={12} />
          跳到根节点
        </button>
      )}
    </div>
  );
}
