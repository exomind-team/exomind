import { ListTodo, Waypoints, Clock3 } from 'lucide-react';
import { PageHeaderNav } from '@/ui/app/components/PageHeaderNav';
import { buildTasksMainSearch } from '@/ui/app/pages/task-route-memory';

type TaskDomainTabId = 'list' | 'timeline' | 'dag';

const TASK_DOMAIN_ITEMS: Array<{
  id: TaskDomainTabId;
  label: string;
  icon: typeof ListTodo;
  to: string;
  search?: Record<string, string>;
}> = [
  { id: 'list', label: '列表', icon: ListTodo, to: '/tasks', search: buildTasksMainSearch() },
  { id: 'timeline', label: '时间线', icon: Clock3, to: '/tasks/timeline' },
  { id: 'dag', label: '依赖图', icon: Waypoints, to: '/tasks/dag' },
];

export function TaskDomainTabs({ active }: { active: TaskDomainTabId }) {
  return (
    <PageHeaderNav
      mode="links"
      rootTestId="task-domain-tabs"
      navLabel="任务域导航"
      activeId={active}
      items={TASK_DOMAIN_ITEMS.map((item) => ({
        ...item,
        testId: `task-domain-tab-${item.id}`,
      }))}
    />
  );
}
