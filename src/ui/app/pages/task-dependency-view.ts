import type { TaskNode, TaskStatus } from '@/lib/types/task';

type DependencyType = 'soft' | 'hard';
type DependencyAction = 'load' | 'add' | 'update' | 'remove';

export interface TaskDependencyItem {
  taskId: string;
  title: string;
  statusLabel: string;
  type: DependencyType;
  typeLabel: string;
  missing: boolean;
}

export interface TaskDependencyCandidate {
  id: string;
  title: string;
  statusLabel: string;
  disabled: boolean;
  disabledReason?: string;
}

export interface TaskDependencyViewModel {
  currentDependencies: TaskDependencyItem[];
  reverseDependencies: TaskDependencyItem[];
  candidates: TaskDependencyCandidate[];
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

const TYPE_LABELS: Record<DependencyType, string> = {
  soft: '软依赖',
  hard: '硬依赖',
};

function buildDependencyItem(taskMap: Map<string, TaskNode>, taskId: string, type: DependencyType): TaskDependencyItem {
  const task = taskMap.get(taskId);
  if (!task) {
    return {
      taskId,
      title: `任务不存在（${taskId}）`,
      statusLabel: '目标不存在',
      type,
      typeLabel: TYPE_LABELS[type],
      missing: true,
    };
  }

  return {
    taskId,
    title: task.title,
    statusLabel: STATUS_LABELS[task.status],
    type,
    typeLabel: TYPE_LABELS[type],
    missing: false,
  };
}

function wouldCreateDependencyCycle(taskId: string, depTaskId: string, taskMap: Map<string, TaskNode>): boolean {
  const visited = new Set<string>();
  const queue = [depTaskId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current === taskId) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const task = taskMap.get(current);
    if (!task) {
      continue;
    }

    for (const dependency of task.dependsOn) {
      if (!visited.has(dependency.taskId)) {
        queue.push(dependency.taskId);
      }
    }
  }

  return false;
}

export function buildTaskDependencyView(task: TaskNode, allTasks: TaskNode[]): TaskDependencyViewModel {
  const taskMap = new Map(allTasks.map((item) => [item.id, item]));
  const existingDependencyIds = new Set(task.dependsOn.map((dependency) => dependency.taskId));

  return {
    currentDependencies: task.dependsOn.map((dependency) => buildDependencyItem(taskMap, dependency.taskId, dependency.type)),
    reverseDependencies: allTasks
      .flatMap((candidate) => candidate.dependsOn
        .filter((dependency) => dependency.taskId === task.id)
        .map((dependency) => buildDependencyItem(taskMap, candidate.id, dependency.type))),
    candidates: allTasks
      .filter((candidate) => candidate.id !== task.id && !existingDependencyIds.has(candidate.id))
      .map((candidate) => {
        const disabledReason = candidate.status === 'abandoned'
          ? '任务已放弃'
          : wouldCreateDependencyCycle(task.id, candidate.id, taskMap)
            ? '会形成循环依赖'
            : undefined;

        return {
          id: candidate.id,
          title: candidate.title,
          statusLabel: STATUS_LABELS[candidate.status],
          disabled: Boolean(disabledReason),
          disabledReason,
        };
      }),
  };
}

export function formatDependencyActionError(error: unknown, action: DependencyAction): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  if (message.toLowerCase().includes('not found')) {
    return '依赖任务不存在，请刷新后重试';
  }

  if (action === 'load') {
    return `依赖列表加载失败：${message || '请稍后重试'}`;
  }
  if (action === 'update') {
    return `更新依赖失败：${message || '请稍后重试'}`;
  }
  if (action === 'remove') {
    return `删除依赖失败：${message || '请稍后重试'}`;
  }
  return `新增依赖失败：${message || '请稍后重试'}`;
}
