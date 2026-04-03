import { Inbox, ListTodo, Waypoints, Clock3 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getProposalInboxEnabled, subscribeProposalInboxEnabledChanges } from '@/config/proposal-inbox-enabled';
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
    <div
      data-testid="task-domain-tabs"
      className="flex items-center gap-1 self-start rounded-[10px] bg-[#F5F0ED] p-1 dark:bg-[#292524]"
    >
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === active;

        return (
          <Link
            key={item.id}
            to={item.to}
            search={item.search as never}
            role="tab"
            aria-selected={isActive}
            data-testid={`task-domain-tab-${item.id}`}
            className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-white text-[#1C1917] shadow-sm dark:bg-[#1C1917] dark:text-[#FAFAF9]'
                : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
            }`}
          >
            <Icon size={14} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
