import { useEffect, useState } from 'react';
import type { GoalDisplayStatus, GoalNode, TaskEdge } from '../goal-types';
import { DetailPanelShell } from './DetailPanelShell';

interface GoalDetailPanelProps {
  goal: GoalNode;
  status: GoalDisplayStatus;
  inEdges: TaskEdge[];
  outEdges: TaskEdge[];
  hopDistance: number;
  onClose: () => void;
  onUpdate: (patch: { title?: string; description?: string; completionRule?: string[][] }) => boolean;
  onJumpEdge: (edgeId: string) => void;
}

function getMode(goal: GoalNode, inEdges: TaskEdge[]): 'AND' | 'OR' | null {
  if (goal.completionRule.length === 0 || inEdges.length === 0) return null;
  if (goal.completionRule.length === 1 && goal.completionRule[0]?.length === inEdges.length) return 'AND';
  if (goal.completionRule.length === inEdges.length && goal.completionRule.every((clause) => clause.length === 1)) return 'OR';
  return null;
}

function formatRule(goal: GoalNode, inEdges: TaskEdge[]): string {
  const labelByEdgeId = new Map(inEdges.map((edge) => [edge.id, edge.title || '待定义']));
  if (goal.completionRule.length === 0) return '无完成条件，请添加任务边';
  return goal.completionRule
    .map((clause) => clause.map((edgeId) => labelByEdgeId.get(edgeId) ?? edgeId).join(' 且 '))
    .join(' 或 ');
}

export function GoalDetailPanel({
  goal,
  status,
  inEdges,
  outEdges,
  hopDistance,
  onClose,
  onUpdate,
  onJumpEdge,
}: GoalDetailPanelProps) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description);
  const frozen = goal.cancelled || status === 'completed';
  const mode = getMode(goal, inEdges);
  const modeLabel = goal.completionRule.length === 0 ? '空规则' : (
    goal.completionRule.length === 1 && goal.completionRule[0]?.length === inEdges.length
      ? 'AND'
      : goal.completionRule.length === inEdges.length && goal.completionRule.every((clause) => clause.length === 1)
        ? 'OR'
        : '自定义'
  );

  useEffect(() => {
    setTitle(goal.title);
    setDescription(goal.description);
  }, [goal]);

  return (
    <DetailPanelShell title={goal.title || '待命名'} subtitle="目标详情" onClose={onClose}>
      <div className="space-y-5">
        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">标题</label>
          <input
            value={title}
            disabled={frozen}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title !== goal.title && !onUpdate({ title })) {
                setTitle(goal.title);
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
              if (description !== goal.description && !onUpdate({ description })) {
                setDescription(goal.description);
              }
            }}
            className="min-h-[120px] w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">状态</span>
            <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {status}
            </span>
          </div>
          <div className="flex gap-2">
            {(['AND', 'OR'] as const).map((item) => (
              <button
                key={item}
                type="button"
                disabled={frozen}
                onClick={() => {
                  const rule = item === 'AND'
                    ? [inEdges.map((edge) => edge.id)]
                    : inEdges.map((edge) => [edge.id]);
                  onUpdate({ completionRule: rule.filter((clause) => clause.length > 0) });
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${mode === item ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C]'}`}
              >
                {item}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#A8A29E]">当前模式：{modeLabel}</p>
          <p className="rounded-2xl bg-[#FAF7F5] px-3 py-2 text-sm text-[#57534E] dark:bg-[#120F0D] dark:text-[#D6D3D1]">
            {formatRule(goal, inEdges)}
          </p>
        </section>

        <section className="rounded-2xl bg-[#FAF7F5] px-4 py-3 text-sm text-[#57534E] dark:bg-[#120F0D] dark:text-[#D6D3D1]">
          {hopDistance === Number.POSITIVE_INFINITY ? '当前从 Me 暂不可达' : `距 Me ${hopDistance} 跳`}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">入边</h3>
          <div className="space-y-2">
            {inEdges.length === 0 ? <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">当前没有入边。</p> : null}
            {inEdges.map((edge) => (
              <button
                key={edge.id}
                type="button"
                onClick={() => onJumpEdge(edge.id)}
                className="block w-full rounded-2xl border border-[#E7E5E4] px-3 py-2 text-left text-sm text-[#1C1917] dark:border-[#3F3F46] dark:text-[#FAFAF9]"
              >
                {edge.title || '待定义'}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">出边</h3>
          <div className="space-y-2">
            {outEdges.length === 0 ? <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">当前没有出边。</p> : null}
            {outEdges.map((edge) => (
              <button
                key={edge.id}
                type="button"
                onClick={() => onJumpEdge(edge.id)}
                className="block w-full rounded-2xl border border-[#E7E5E4] px-3 py-2 text-left text-sm text-[#1C1917] dark:border-[#3F3F46] dark:text-[#FAFAF9]"
              >
                {edge.title || '待定义'}
              </button>
            ))}
          </div>
        </section>
      </div>
    </DetailPanelShell>
  );
}
