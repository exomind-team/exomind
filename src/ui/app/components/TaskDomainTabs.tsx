import { Inbox, ListTodo, Waypoints, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getProposalInboxEnabled, subscribeProposalInboxEnabledChanges } from '@/config/proposal-inbox-enabled';
import { PageHeaderNav } from '@/ui/app/components/PageHeaderNav';
import { buildTasksMainSearch } from '@/ui/app/pages/task-route-memory';

type TaskDomainTabId = 'list' | 'timeline' | 'dag' | 'proposals';

const TASK_DOMAIN_ITEMS: Array<{
  id: TaskDomainTabId;
  label: string;
  icon: typeof ListTodo;
  to: string;
  search?: Record<string, string>;
}> = [
  { id: 'list', label: '任务', icon: ListTodo, to: '/tasks', search: buildTasksMainSearch() },
  { id: 'timeline', label: '时间线', icon: Clock3, to: '/tasks/timeline' },
  { id: 'dag', label: '依赖图', icon: Waypoints, to: '/tasks/dag' },
  { id: 'proposals', label: '请求箱', icon: Inbox, to: '/proposals' },
];

export function TaskDomainTabs({ active }: { active: TaskDomainTabId }) {
  const [proposalInboxEnabled, setProposalInboxEnabled] = useState(() => getProposalInboxEnabled());

  useEffect(() => subscribeProposalInboxEnabledChanges(setProposalInboxEnabled), []);

  const visibleItems = TASK_DOMAIN_ITEMS.filter((item) => (
    item.id !== 'proposals' || proposalInboxEnabled || active === 'proposals'
  ));

  return (
    <PageHeaderNav
      mode="links"
      rootTestId="task-domain-tabs"
      navLabel="任务域导航"
      activeId={active}
      items={visibleItems.map((item) => ({
        ...item,
        testId: `task-domain-tab-${item.id}`,
      }))}
    />
  );
}
