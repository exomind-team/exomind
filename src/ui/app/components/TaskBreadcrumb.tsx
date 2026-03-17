import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { TASKS_LAST_PATH_KEY, buildTasksMainSearch } from '@/ui/app/pages/task-route-memory';

export interface TaskBreadcrumbSegment {
  label: string;
  to: string;
  search?: Record<string, string>;
  icon?: LucideIcon;
}

export interface TaskBreadcrumbProps {
  segments: TaskBreadcrumbSegment[];
  current: { label: string; icon?: LucideIcon };
}

function clearTaskPathMemory() {
  sessionStorage.removeItem(TASKS_LAST_PATH_KEY);
}

function resolveSegmentSearch(segment: TaskBreadcrumbSegment): Record<string, string> | undefined {
  if (segment.to !== '/tasks') {
    return segment.search;
  }

  return buildTasksMainSearch(segment.search);
}

export function TaskBreadcrumb({ segments, current }: TaskBreadcrumbProps) {
  return (
    <div className="inline-flex select-none items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
      {segments.map((segment, index) => (
        <span key={segment.to} className="contents">
          <Link
            to={segment.to}
            search={resolveSegmentSearch(segment)}
            onClick={segment.to === '/tasks' ? clearTaskPathMemory : undefined}
            className="inline-flex items-center gap-1 hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
          >
            {index === 0 ? <ArrowLeft size={14} /> : null}
            {segment.icon ? <segment.icon size={14} /> : null}
            {segment.label}
          </Link>
          <span>/</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        {current.icon ? <current.icon size={14} /> : null}
        {current.label}
      </span>
    </div>
  );
}
