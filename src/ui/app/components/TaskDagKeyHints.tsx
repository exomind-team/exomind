import type { TaskDagMode } from '@/ui/app/components/TaskDagModeSelector';

interface TaskDagKeyHintsProps {
  mode: TaskDagMode;
  hasSelectedNode: boolean;
  hasConnectSource: boolean;
  immersive: boolean;
}

export function TaskDagKeyHints({
  mode,
  hasSelectedNode,
  hasConnectSource,
  immersive,
}: TaskDagKeyHintsProps) {
  if (immersive) {
    return null;
  }

  const hints: Array<{ keys: string; label: string }> = [
    { keys: 'Ctrl+←/→', label: '切换模式' },
    { keys: '↑↓←→', label: '平移画布' },
    { keys: 'WASD', label: hasSelectedNode ? '导航节点' : '平移画布' },
  ];

  if (mode === 'connect') {
    if (!hasConnectSource && hasSelectedNode) {
      hints.push({ keys: 'Enter', label: '设为连接起点' });
    }
    if (hasConnectSource) {
      hints.push({ keys: 'Enter', label: '建立依赖' });
      hints.push({ keys: 'Esc', label: '取消连接' });
      hints.push({ keys: '空白单击', label: '创建下游任务' });
      hints.push({ keys: 'Shift+空白', label: '创建上游任务' });
    }
    if (hasSelectedNode) {
      hints.push({ keys: 'Tab', label: '快速新增下游' });
      hints.push({ keys: 'Shift+Tab', label: '快速新增上游' });
    }
  }

  return (
    <div
      data-testid="task-dag-key-hints"
      className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-wrap justify-end gap-x-3 gap-y-1 rounded-xl border border-[#E7E3E0] bg-white/90 px-3 py-2 text-[10px] text-[#78716C] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E]"
    >
      {hints.map((hint) => (
        <span key={`${hint.keys}-${hint.label}`}>
          <kbd className="rounded bg-[#F5F0ED] px-1 py-0.5 font-mono text-[9px] dark:bg-[#292524]">{hint.keys}</kbd>
          {' '}
          {hint.label}
        </span>
      ))}
    </div>
  );
}
