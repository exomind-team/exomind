export type TaskDomainView = 'list' | 'timeline' | 'dag' | 'proposals';
export type TaskDomainSource = 'dag' | 'timeline' | 'timeblocks';

const TASK_DOMAIN_VIEW_PATHS: Record<TaskDomainView, string> = {
  list: '/tasks',
  timeline: '/tasks/timeline',
  dag: '/tasks/dag',
  proposals: '/proposals',
};

const TASK_DOMAIN_SOURCE_CONFIG: Record<TaskDomainSource, { label: string; to: string }> = {
  dag: { label: '依赖图', to: TASK_DOMAIN_VIEW_PATHS.dag },
  timeline: { label: '时间线', to: TASK_DOMAIN_VIEW_PATHS.timeline },
  timeblocks: { label: '时间线', to: TASK_DOMAIN_VIEW_PATHS.timeline },
};

export function getTaskDomainViewPath(view: TaskDomainView): string {
  return TASK_DOMAIN_VIEW_PATHS[view];
}

export function resolveTaskDomainSourceConfig(source: string | null | undefined): {
  label: string;
  to: string;
} | null {
  if (!source) {
    return null;
  }

  return Object.prototype.hasOwnProperty.call(TASK_DOMAIN_SOURCE_CONFIG, source)
    ? TASK_DOMAIN_SOURCE_CONFIG[source as TaskDomainSource]
    : null;
}

export function buildTaskDetailSourceSearch(source: TaskDomainSource): Record<string, string> {
  return { from: source };
}

export function buildTaskDomainBackLink(
  source: string | null | undefined,
  fallback: TaskDomainView = 'list',
): {
  to: string;
  label: string;
  sourceLabel: string;
} {
  const sourceConfig = resolveTaskDomainSourceConfig(source);
  if (sourceConfig) {
    return {
      to: sourceConfig.to,
      label: `← 返回${sourceConfig.label}`,
      sourceLabel: sourceConfig.label,
    };
  }

  return {
    to: TASK_DOMAIN_VIEW_PATHS[fallback],
    label: '← 返回任务',
    sourceLabel: '任务',
  };
}
