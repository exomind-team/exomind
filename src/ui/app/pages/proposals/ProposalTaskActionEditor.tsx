import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  ProposalTaskDependency,
  TaskCreateProposalActionParams,
  TaskUpdateProposalActionParams,
} from '@/lib/types/proposal';
import type { TaskNode } from '@/lib/types/task';
import type { ReactNode } from 'react';

type TaskPriority = 'low' | 'medium' | 'high';
type UpdateValueMode = 'unchanged' | 'set' | 'clear';

const TASK_STATUS_LABELS: Record<TaskNode['status'], string> = {
  pending: '待开始',
  in_progress: '进行中',
  suspended: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
};

function joinTags(tags?: string[]): string {
  return tags?.join(', ') ?? '';
}

function splitTags(value: string): string[] | undefined {
  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function toLocalDateTimeInputValue(value?: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveTaskMeta(taskId: string, taskLookup: Map<string, TaskNode>): string {
  const task = taskLookup.get(taskId);
  if (!task) {
    return '引用未解析';
  }
  return `${task.title} · ${TASK_STATUS_LABELS[task.status]}`;
}

function renderDependencySummary(
  dependency: ProposalTaskDependency,
  taskLookup: Map<string, TaskNode>,
) {
  return (
    <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
      {resolveTaskMeta(dependency.taskId, taskLookup)}
    </p>
  );
}

function DependencyListEditor({
  dependencies,
  disabled,
  taskLookup,
  onChange,
}: {
  dependencies: ProposalTaskDependency[];
  disabled: boolean;
  taskLookup: Map<string, TaskNode>;
  onChange: (next: ProposalTaskDependency[]) => void;
}) {
  const updateDependency = (
    index: number,
    patch: Partial<ProposalTaskDependency>,
  ) => {
    onChange(
      dependencies.map((dependency, candidateIndex) => (
        candidateIndex === index ? { ...dependency, ...patch } : dependency
      )),
    );
  };

  return (
    <div className="space-y-3">
      {dependencies.length === 0 ? (
        <p className="text-xs text-[#A8A29E] dark:text-[#78716C]">
          当前没有依赖。
        </p>
      ) : (
        dependencies.map((dependency, index) => (
          <div
            key={`${dependency.taskId}-${index}`}
            className="rounded-2xl border border-[#E7E5E4] bg-[#FCFBFA] p-3 dark:border-[#292524] dark:bg-[#120F0D]"
          >
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
              <Input
                value={dependency.taskId}
                onChange={(event) => updateDependency(index, {
                  taskId: event.target.value,
                })}
                placeholder="任务 ID"
                disabled={disabled}
                className="rounded-2xl"
              />
              <select
                value={dependency.type}
                onChange={(event) => updateDependency(index, {
                  type: event.target.value as ProposalTaskDependency['type'],
                })}
                disabled={disabled}
                className="rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm dark:border-[#292524] dark:bg-[#1C1917]"
              >
                <option value="hard">硬依赖</option>
                <option value="soft">软依赖</option>
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() => onChange(dependencies.filter((_, candidateIndex) => candidateIndex !== index))}
                disabled={disabled}
                className="rounded-full"
              >
                移除
              </Button>
            </div>
            <div className="mt-2">
              {renderDependencySummary(dependency, taskLookup)}
            </div>
          </div>
        ))
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...dependencies, { taskId: '', type: 'hard' }])}
        disabled={disabled}
        className="rounded-full"
      >
        添加依赖
      </Button>
    </div>
  );
}

function UpdateFieldMode({
  label,
  mode,
  disabled,
  onChange,
  children,
}: {
  label: string;
  mode: UpdateValueMode;
  disabled: boolean;
  onChange: (next: UpdateValueMode) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
        {label}
      </label>
      <select
        value={mode}
        onChange={(event) => onChange(event.target.value as UpdateValueMode)}
        disabled={disabled}
        className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <option value="unchanged">保持原值</option>
        <option value="set">设置新值</option>
        <option value="clear">清空</option>
      </select>
      {mode === 'set' ? children : null}
    </div>
  );
}

function TaskCreateEditor({
  params,
  disabled,
  taskLookup,
  onChange,
}: {
  params: TaskCreateProposalActionParams;
  disabled: boolean;
  taskLookup: Map<string, TaskNode>;
  onChange: (next: TaskCreateProposalActionParams) => void;
}) {
  const { fields } = params;

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          任务标题
        </label>
        <Input
          value={fields.title}
          onChange={(event) => onChange({
            fields: {
              ...fields,
              title: event.target.value,
            },
          })}
          placeholder="任务标题"
          disabled={disabled}
          className="rounded-2xl"
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          描述
        </label>
        <Textarea
          value={fields.description ?? ''}
          onChange={(event) => onChange({
            fields: {
              ...fields,
              ...(event.target.value.trim()
                ? { description: event.target.value }
                : { description: undefined }),
            },
          })}
          rows={4}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          完成条件
        </label>
        <Textarea
          value={fields.doneCondition ?? ''}
          onChange={(event) => onChange({
            fields: {
              ...fields,
              ...(event.target.value.trim()
                ? { doneCondition: event.target.value }
                : { doneCondition: undefined }),
            },
          })}
          rows={3}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          优先级
        </label>
        <select
          value={fields.priority ?? ''}
          onChange={(event) => onChange({
            fields: {
              ...fields,
              ...(event.target.value
                ? { priority: event.target.value as TaskPriority }
                : { priority: undefined }),
            },
          })}
          disabled={disabled}
          className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <option value="">未设置</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          预计时长（分钟）
        </label>
        <Input
          type="number"
          min={1}
          value={fields.estimatedMinutes ?? ''}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange({
              fields: {
                ...fields,
                ...(nextValue ? { estimatedMinutes: Number(nextValue) } : { estimatedMinutes: undefined }),
              },
            });
          }}
          disabled={disabled}
          className="rounded-2xl"
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          标签（逗号分隔）
        </label>
        <Input
          value={joinTags(fields.tags)}
          onChange={(event) => onChange({
            fields: {
              ...fields,
              ...(splitTags(event.target.value) !== undefined
                ? { tags: splitTags(event.target.value) }
                : { tags: undefined }),
            },
          })}
          placeholder="验收, proposal, task"
          disabled={disabled}
          className="rounded-2xl"
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          截止时间
        </label>
        <Input
          type="datetime-local"
          value={toLocalDateTimeInputValue(fields.dueAt)}
          onChange={(event) => {
            const dueAt = fromLocalDateTimeInputValue(event.target.value);
            onChange({
              fields: {
                ...fields,
                ...(dueAt ? { dueAt } : { dueAt: undefined }),
              },
            });
          }}
          disabled={disabled}
          className="rounded-2xl"
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          依赖关系
        </label>
        <DependencyListEditor
          dependencies={fields.dependsOn ?? []}
          disabled={disabled}
          taskLookup={taskLookup}
          onChange={(dependsOn) => onChange({
            fields: {
              ...fields,
              ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: undefined }),
            },
          })}
        />
      </div>
    </div>
  );
}

function TaskUpdateEditor({
  params,
  disabled,
  taskLookup,
  onChange,
}: {
  params: TaskUpdateProposalActionParams;
  disabled: boolean;
  taskLookup: Map<string, TaskNode>;
  onChange: (next: TaskUpdateProposalActionParams) => void;
}) {
  const patch = params.patch;
  const descriptionMode: UpdateValueMode = patch.description === undefined ? 'unchanged' : patch.description === null ? 'clear' : 'set';
  const doneConditionMode: UpdateValueMode = patch.doneCondition === undefined ? 'unchanged' : patch.doneCondition === null ? 'clear' : 'set';
  const estimatedMinutesMode: UpdateValueMode = patch.estimatedMinutes === undefined ? 'unchanged' : patch.estimatedMinutes === null ? 'clear' : 'set';
  const dueAtMode: UpdateValueMode = patch.dueAt === undefined ? 'unchanged' : patch.dueAt === null ? 'clear' : 'set';
  const tagsMode: UpdateValueMode = patch.tags === undefined ? 'unchanged' : patch.tags.length === 0 ? 'clear' : 'set';
  const dependsOnMode: UpdateValueMode = patch.dependsOn === undefined ? 'unchanged' : patch.dependsOn.length === 0 ? 'clear' : 'set';

  const updatePatch = (nextPatch: TaskUpdateProposalActionParams['patch']) => {
    onChange({
      taskId: params.taskId,
      patch: nextPatch,
    });
  };

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          目标任务 ID
        </label>
        <Input
          value={params.taskId}
          onChange={(event) => onChange({
            ...params,
            taskId: event.target.value,
          })}
          placeholder="task-123"
          disabled={disabled}
          className="rounded-2xl"
        />
        <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
          {resolveTaskMeta(params.taskId, taskLookup)}
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          标题
        </label>
        <Input
          value={patch.title ?? ''}
          onChange={(event) => updatePatch({
            ...patch,
            ...(event.target.value.trim() ? { title: event.target.value } : { title: undefined }),
          })}
          placeholder="保持原值则留空"
          disabled={disabled}
          className="rounded-2xl"
        />
        <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
          留空表示不修改标题。
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
          优先级
        </label>
        <select
          value={patch.priority ?? 'unchanged'}
          onChange={(event) => updatePatch({
            ...patch,
            ...(event.target.value === 'unchanged'
              ? { priority: undefined }
              : { priority: event.target.value as TaskPriority }),
          })}
          disabled={disabled}
          className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <option value="unchanged">保持原值</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
      </div>

      <div className="md:col-span-2">
        <UpdateFieldMode
          label="描述"
          mode={descriptionMode}
          disabled={disabled}
          onChange={(nextMode) => updatePatch({
            ...patch,
            ...(nextMode === 'unchanged'
              ? { description: undefined }
              : nextMode === 'clear'
                ? { description: null }
                : { description: patch.description ?? '' }),
          })}
        >
          <Textarea
            value={typeof patch.description === 'string' ? patch.description : ''}
            onChange={(event) => updatePatch({
              ...patch,
              description: event.target.value.trim() ? event.target.value : null,
            })}
            rows={4}
            disabled={disabled}
          />
        </UpdateFieldMode>
      </div>

      <div className="md:col-span-2">
        <UpdateFieldMode
          label="完成条件"
          mode={doneConditionMode}
          disabled={disabled}
          onChange={(nextMode) => updatePatch({
            ...patch,
            ...(nextMode === 'unchanged'
              ? { doneCondition: undefined }
              : nextMode === 'clear'
                ? { doneCondition: null }
                : { doneCondition: patch.doneCondition ?? '' }),
          })}
        >
          <Textarea
            value={typeof patch.doneCondition === 'string' ? patch.doneCondition : ''}
            onChange={(event) => updatePatch({
              ...patch,
              doneCondition: event.target.value.trim() ? event.target.value : null,
            })}
            rows={3}
            disabled={disabled}
          />
        </UpdateFieldMode>
      </div>

      <div className="space-y-2 md:col-span-2">
        <UpdateFieldMode
          label="标签（逗号分隔）"
          mode={tagsMode}
          disabled={disabled}
          onChange={(nextMode) => updatePatch({
            ...patch,
            ...(nextMode === 'unchanged'
              ? { tags: undefined }
              : nextMode === 'clear'
                ? { tags: [] }
                : { tags: patch.tags ?? [] }),
          })}
        >
          <Input
            value={joinTags(patch.tags)}
            onChange={(event) => updatePatch({
              ...patch,
              tags: splitTags(event.target.value) ?? [],
            })}
            placeholder="验收, proposal, task"
            disabled={disabled}
            className="rounded-2xl"
          />
        </UpdateFieldMode>
      </div>

      <div className="space-y-2">
        <UpdateFieldMode
          label="预计时长（分钟）"
          mode={estimatedMinutesMode}
          disabled={disabled}
          onChange={(nextMode) => updatePatch({
            ...patch,
            ...(nextMode === 'unchanged'
              ? { estimatedMinutes: undefined }
              : nextMode === 'clear'
                ? { estimatedMinutes: null }
                : { estimatedMinutes: patch.estimatedMinutes ?? 30 }),
          })}
        >
          <Input
            type="number"
            min={1}
            value={patch.estimatedMinutes ?? ''}
            onChange={(event) => updatePatch({
              ...patch,
              estimatedMinutes: event.target.value ? Number(event.target.value) : null,
            })}
            disabled={disabled}
            className="rounded-2xl"
          />
        </UpdateFieldMode>
      </div>

      <div className="space-y-2">
        <UpdateFieldMode
          label="截止时间"
          mode={dueAtMode}
          disabled={disabled}
          onChange={(nextMode) => updatePatch({
            ...patch,
            ...(nextMode === 'unchanged'
              ? { dueAt: undefined }
              : nextMode === 'clear'
                ? { dueAt: null }
                : { dueAt: patch.dueAt ?? new Date().toISOString() }),
          })}
        >
          <Input
            type="datetime-local"
            value={toLocalDateTimeInputValue(patch.dueAt)}
            onChange={(event) => updatePatch({
              ...patch,
              dueAt: fromLocalDateTimeInputValue(event.target.value),
            })}
            disabled={disabled}
            className="rounded-2xl"
          />
        </UpdateFieldMode>
      </div>

      <div className="space-y-2 md:col-span-2">
        <UpdateFieldMode
          label="依赖关系"
          mode={dependsOnMode}
          disabled={disabled}
          onChange={(nextMode) => updatePatch({
            ...patch,
            ...(nextMode === 'unchanged'
              ? { dependsOn: undefined }
              : nextMode === 'clear'
                ? { dependsOn: [] }
                : { dependsOn: patch.dependsOn ?? [] }),
          })}
        >
          <DependencyListEditor
            dependencies={patch.dependsOn ?? []}
            disabled={disabled}
            taskLookup={taskLookup}
            onChange={(dependsOn) => updatePatch({
              ...patch,
              dependsOn,
            })}
          />
        </UpdateFieldMode>
      </div>
    </div>
  );
}

export function ProposalTaskActionEditor({
  actionType,
  disabled,
  validationError,
  taskCreateParams,
  taskUpdateParams,
  taskLookup,
  onChangeTaskCreate,
  onChangeTaskUpdate,
}: {
  actionType: 'task.create' | 'task.update';
  disabled: boolean;
  validationError: string | null;
  taskCreateParams: TaskCreateProposalActionParams | null;
  taskUpdateParams: TaskUpdateProposalActionParams | null;
  taskLookup: Map<string, TaskNode>;
  onChangeTaskCreate: (next: TaskCreateProposalActionParams) => void;
  onChangeTaskUpdate: (next: TaskUpdateProposalActionParams) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">
        结构化字段和下方 JSON 双向同步；`task.create / task.update` 共用同一套白名单校验。
      </p>

      {validationError ? (
        <div className="rounded-2xl border border-[#F5C7B8] bg-[#FFF7ED] px-4 py-3 text-xs text-[#9A3412] dark:border-[#7C2D12] dark:bg-[#1C1917] dark:text-[#FDBA74]">
          当前 JSON 已经偏离 task proposal contract：{validationError}
          <br />
          先修正 JSON，结构化编辑区才会恢复可用。
        </div>
      ) : null}

      {actionType === 'task.create' && taskCreateParams ? (
        <TaskCreateEditor
          params={taskCreateParams}
          disabled={disabled}
          taskLookup={taskLookup}
          onChange={onChangeTaskCreate}
        />
      ) : null}

      {actionType === 'task.update' && taskUpdateParams ? (
        <TaskUpdateEditor
          params={taskUpdateParams}
          disabled={disabled}
          taskLookup={taskLookup}
          onChange={onChangeTaskUpdate}
        />
      ) : null}
    </div>
  );
}
