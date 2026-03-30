import { useEffect, useState } from 'react';

import type { GoalNode } from '../goal-types';

interface SplitEdgeDialogProps {
  open: boolean;
  availableGoals: GoalNode[];
  insertMode: 'new' | 'existing';
  existingGoalId: string;
  newGoalTitle: string;
  originalEdgePlacement: 'first-half' | 'second-half';
  onInsertModeChange: (mode: 'new' | 'existing') => void;
  onExistingGoalIdChange: (goalId: string) => void;
  onNewGoalTitleChange: (title: string) => void;
  onOriginalEdgePlacementChange: (placement: 'first-half' | 'second-half') => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SplitEdgeDialog({
  open,
  availableGoals,
  insertMode,
  existingGoalId,
  newGoalTitle,
  originalEdgePlacement,
  onInsertModeChange,
  onExistingGoalIdChange,
  onNewGoalTitleChange,
  onOriginalEdgePlacementChange,
  onCancel,
  onConfirm,
}: SplitEdgeDialogProps) {
  const [goalSearchQuery, setGoalSearchQuery] = useState('');

  useEffect(() => {
    if (!open || insertMode !== 'existing') {
      setGoalSearchQuery('');
    }
  }, [insertMode, open]);

  if (!open) return null;

  const normalizedQuery = goalSearchQuery.trim().toLowerCase();
  const filteredGoals = normalizedQuery
    ? availableGoals.filter((goal) => {
        const normalizedTitle = goal.title.trim().toLowerCase();
        return normalizedTitle.includes(normalizedQuery) || goal.id.toLowerCase().includes(normalizedQuery);
      })
    : availableGoals;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#1C1917]/30 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-[28px] border border-[#F0D7CA] bg-[linear-gradient(180deg,rgba(255,250,247,0.98),rgba(250,245,241,0.98))] p-5 shadow-[0_30px_80px_-32px_rgba(120,113,108,0.55)] dark:border-[#3F3F46] dark:bg-[#1C1917]">
        <h3 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">拆解路径</h3>
        <p className="mt-2 text-sm text-[#57534E] dark:text-[#D6D3D1]">
          在当前路径中插入一个中间目标，让依赖关系更接近真实推进链路。
        </p>

        <section className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">中间节点</p>
          <div className="flex gap-2">
            {(['new', 'existing'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onInsertModeChange(mode)}
                className={
                  insertMode === mode
                    ? 'rounded-full bg-[#C75B3A] px-3 py-1.5 text-xs font-semibold text-white'
                    : 'rounded-full border border-[#E7E5E4] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#57534E] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#D6D3D1]'
                }
              >
                {mode === 'new' ? '新建目标' : '选择已有目标'}
              </button>
            ))}
          </div>

          {insertMode === 'new' ? (
            <label className="block space-y-2">
              <span className="text-sm text-[#57534E] dark:text-[#D6D3D1]">中间目标标题</span>
              <input
                aria-label="中间目标标题"
                value={newGoalTitle}
                onChange={(event) => onNewGoalTitleChange(event.target.value)}
                placeholder="例如：准备环境"
                className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
              />
            </label>
          ) : (
            <label className="block space-y-2">
              <span className="text-sm text-[#57534E] dark:text-[#D6D3D1]">选择已有目标</span>
              <input
                aria-label="搜索已有目标"
                value={goalSearchQuery}
                onChange={(event) => setGoalSearchQuery(event.target.value)}
                placeholder="搜索标题或 ID"
                className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
              />
              <select
                aria-label="选择已有目标"
                value={existingGoalId}
                onChange={(event) => onExistingGoalIdChange(event.target.value)}
                className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
              >
                <option value="">请选择目标</option>
                {filteredGoals.length > 0 ? (
                  filteredGoals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title || '待命名'}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>
                    没有匹配目标
                  </option>
                )}
              </select>
            </label>
          )}
        </section>

        <section className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">原边分配</p>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => onOriginalEdgePlacementChange('second-half')}
              className={
                originalEdgePlacement === 'second-half'
                  ? 'rounded-2xl border border-[#C75B3A] bg-[#FFF7ED] px-3 py-2 text-left text-sm text-[#9A3412]'
                  : 'rounded-2xl border border-[#E7E5E4] bg-white/80 px-3 py-2 text-left text-sm text-[#57534E] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#D6D3D1]'
              }
            >
              原边作为后半段
            </button>
            <button
              type="button"
              onClick={() => onOriginalEdgePlacementChange('first-half')}
              className={
                originalEdgePlacement === 'first-half'
                  ? 'rounded-2xl border border-[#C75B3A] bg-[#FFF7ED] px-3 py-2 text-left text-sm text-[#9A3412]'
                  : 'rounded-2xl border border-[#E7E5E4] bg-white/80 px-3 py-2 text-left text-sm text-[#57534E] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#D6D3D1]'
              }
            >
              原边作为前半段
            </button>
          </div>
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full border border-[#E7E5E4] px-4 py-2 text-sm">
            返回
          </button>
          <button type="button" onClick={onConfirm} className="rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white">
            确认拆解
          </button>
        </div>
      </div>
    </div>
  );
}
