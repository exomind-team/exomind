import { Keyboard, MousePointerClick } from 'lucide-react';
import type { TaskDagMode } from '@/ui/app/components/TaskDagModeSelector';

interface TaskDagKeyHintsProps {
  isDesktop: boolean;
  mode: TaskDagMode;
  hasSelectedNode: boolean;
  hasConnectSource: boolean;
  immersive: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function TaskDagKeyHints({
  isDesktop,
  mode,
  hasSelectedNode,
  hasConnectSource,
  immersive,
  mobileOpen,
  onMobileOpenChange,
}: TaskDagKeyHintsProps) {
  if (immersive) {
    return null;
  }

  const hints: Array<{ keys: string; label: string }> = [
    { keys: 'Ctrl+Alt+←/→', label: '切换模式' },
    { keys: '↑↓←→', label: '长按平移' },
    { keys: 'WASD', label: hasSelectedNode ? '导航节点' : '长按平移' },
    { keys: 'Z / Shift+Z', label: '长按缩放' },
  ];
  const mouseHints: Array<{ label: string }> = [];

  if (!hasSelectedNode) {
    hints.push({ keys: 'E', label: '聚焦屏幕中心最近节点' });
  }

  if (mode === 'connect') {
    if (!hasConnectSource && hasSelectedNode) {
      hints.push({ keys: 'Enter / Space', label: '设为连接起点' });
    }
    if (hasConnectSource) {
      hints.push({ keys: 'Enter', label: '建立依赖' });
      hints.push({ keys: 'Esc', label: '取消连接' });
      hints.push({ keys: 'Tab', label: '快速新增下游' });
      hints.push({ keys: 'Shift+Tab', label: '快速新增上游' });
      mouseHints.push({ label: '空白单击 新建下游' });
      mouseHints.push({ label: 'Shift+空白单击 新建上游' });
    }
  }

  if (hasSelectedNode || hasConnectSource) {
    hints.push({ keys: 'Alt+F', label: '折叠/展开下游' });
    hints.push({ keys: 'Alt+Shift+F', label: '折叠/展开上游' });
  }

  if (mode === 'browse') {
    mouseHints.push({ label: '单击节点 查看侧栏' });
    mouseHints.push({ label: '双击节点 打开详情' });
    mouseHints.push({ label: '空白单击 取消选中' });
  } else if (mode === 'connect') {
    mouseHints.push({ label: '单击节点 选择或建依赖' });
    mouseHints.push({ label: '双击空白处 快速创建任务' });
  } else {
    mouseHints.push({ label: '单击节点 开始/追加/移除关联' });
    mouseHints.push({ label: '右击节点 结束或折叠' });
  }

  const contentClassName = isDesktop
    ? 'pointer-events-none absolute bottom-3 right-3 z-10 flex max-w-[50%] flex-col gap-1 rounded-xl border border-[#E7E3E0] bg-white/90 px-3 py-2 text-[10px] text-[#78716C] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E]'
    : 'pointer-events-none absolute bottom-16 right-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-xl border border-[#E7E3E0] bg-white/90 px-3 py-2 text-[10px] text-[#78716C] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E]';

  const content = (
    <div
      data-testid="task-dag-key-hints"
      className={contentClassName}
    >
      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
        {hints.map((hint) => (
          <span key={`${hint.keys}-${hint.label}`}>
            <kbd className="rounded bg-[#F5F0ED] px-1 py-0.5 font-mono text-[9px] dark:bg-[#292524]">{hint.keys}</kbd>
            {' '}
            {hint.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-t border-[#E7E3E0]/80 pt-1 dark:border-[#3C3836]/80">
        {mouseHints.map((hint) => (
          <span key={hint.label} className="inline-flex items-center gap-1">
            <MousePointerClick size={11} />
            {hint.label}
          </span>
        ))}
      </div>
    </div>
  );

  if (isDesktop) {
    return content;
  }

  return (
    <>
      <button
        type="button"
        data-testid="task-dag-key-hints-toggle"
        onClick={() => onMobileOpenChange(!mobileOpen)}
        className="pointer-events-auto absolute bottom-3 right-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E7E3E0] bg-white/90 text-[#57534E] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]"
        aria-expanded={mobileOpen}
        aria-label="切换键盘提示"
      >
        <Keyboard size={16} />
      </button>
      {mobileOpen ? content : null}
    </>
  );
}
