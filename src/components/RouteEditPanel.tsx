import { useEffect, useState } from 'react';
import type { SignalRoute, TargetType } from '@/lib/types/signal-pool';

export interface RouteEditPanelProps {
  route: SignalRoute | null;
  availableTopics: string[];
  availableAgents: { id: string; name: string }[];
  availableActors: { id: string; name: string }[];
  onSave: (data: Omit<SignalRoute, 'id' | 'created_at' | 'updated_at'>) => void;
  onDelete?: () => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export function RouteEditPanel({
  route,
  availableTopics,
  availableAgents,
  availableActors,
  onSave,
  onDelete,
  onCancel,
  isSaving = false,
}: RouteEditPanelProps) {
  const [topic, setTopic] = useState(route?.topic ?? '');
  const [targetType, setTargetType] = useState<TargetType>(route?.target_type ?? 'agent');
  const [targetRef, setTargetRef] = useState(route?.target_ref ?? '');
  const [enabled, setEnabled] = useState(route?.enabled ?? true);

  useEffect(() => {
    setTopic(route?.topic ?? '');
    setTargetType(route?.target_type ?? 'agent');
    setTargetRef(route?.target_ref ?? '');
    setEnabled(route?.enabled ?? true);
  }, [route]);

  const handleSubmit = () => {
    if (!topic.trim() || !targetRef.trim()) return;
    onSave({ topic: topic.trim(), target_type: targetType, target_ref: targetRef.trim(), enabled });
  };

  const targetOptions =
    targetType === 'agent'
      ? availableAgents
      : targetType === 'actor'
        ? availableActors
        : [];

  return (
    <div className="flex flex-col gap-4 p-4 text-foreground">
      {/* Topic */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Topic</span>
        <input
          type="text"
          list="route-edit-topics"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. voice.input.transcript / user.input.text"
          className="rounded-lg border border-border-card bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#C75B3A] focus:outline-none"
        />
        <datalist id="route-edit-topics">
          {availableTopics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>

      {/* Target Type */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Target Type</span>
        <select
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value as TargetType);
            setTargetRef('');
          }}
          className="rounded-lg border border-border-card bg-card px-3 py-2 text-sm text-foreground focus:border-[#C75B3A] focus:outline-none"
        >
          <option value="agent">Agent</option>
          <option value="actor">Actor</option>
          <option value="frontend">Frontend</option>
          <option value="remote">Remote</option>
        </select>
      </label>

      {/* Target Ref */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Target Ref</span>
        {targetOptions.length > 0 ? (
          <select
            value={targetRef}
            onChange={(e) => setTargetRef(e.target.value)}
            className="rounded-lg border border-border-card bg-card px-3 py-2 text-sm text-foreground focus:border-[#C75B3A] focus:outline-none"
          >
            <option value="">选择目标…</option>
            {targetOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name || opt.id}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={targetRef}
            onChange={(e) => setTargetRef(e.target.value)}
            placeholder="e.g. ui"
            className="rounded-lg border border-border-card bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#C75B3A] focus:outline-none"
          />
        )}
      </label>

      {/* Enabled */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-border-card bg-card accent-[#C75B3A]"
        />
        <span className="text-sm text-foreground">启用</span>
      </label>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving || !topic.trim() || !targetRef.trim()}
          className="flex-1 rounded-lg bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSaving ? '保存中…' : route ? '更新' : '创建'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border-card px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          取消
        </button>
      </div>

      {/* Delete */}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="mt-2 text-xs text-red-400 hover:text-red-300"
        >
          删除此路由
        </button>
      )}
    </div>
  );
}
