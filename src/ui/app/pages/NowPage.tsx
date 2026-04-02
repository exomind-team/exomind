import { ListTodo, NotebookPen, Target } from 'lucide-react';
import { ChatPage } from '@/components/Chat/ChatPage';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  EVENTLOG_TAB_VALUES,
  getEventlogPathForTab,
  resolveLegacyEventlogTabSearch,
  resolveEventlogTabFromLocation,
  setEventlogLastTab,
} from '@/ui/app/pages/eventlog-route-memory';

type NowTabValue = (typeof EVENTLOG_TAB_VALUES)[number];

const NOW_VIEW_ITEMS: Array<{ id: NowTabValue; label: string; icon: typeof Target }> = [
  { id: 'focus', label: '专注', icon: Target },
  { id: 'record', label: '记录', icon: NotebookPen },
  { id: 'today', label: '今日', icon: ListTodo },
];

function NowViewBar({
  value,
  onChange,
}: {
  value: NowTabValue;
  onChange: (value: NowTabValue) => void;
}) {
  return (
    <div data-testid="now-page-view-bar" className="flex items-center gap-1 self-start rounded-[10px] bg-[#F5F0ED] p-1 dark:bg-[#292524]">
        {NOW_VIEW_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-testid={`now-page-view-toggle-${item.id}`}
              aria-selected={active}
              onClick={() => onChange(item.id)}
              className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-white text-[#1C1917] shadow-sm dark:bg-[#1C1917] dark:text-[#FAFAF9]'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
              }`}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
    </div>
  );
}

export function NowPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [prestartSelectedTaskIds, setPrestartSelectedTaskIds] = useState<string[]>([]);
  const activeTab = resolveEventlogTabFromLocation(location.pathname, location.searchStr ?? '');

  useEffect(() => {
    const hasExplicitLegacyTab = resolveLegacyEventlogTabSearch(location.searchStr ?? '') !== null;
    if (location.pathname === '/eventlog' && !hasExplicitLegacyTab) {
      return;
    }
    setEventlogLastTab(activeTab);
  }, [activeTab, location.pathname, location.searchStr]);

  const handleViewChange = (nextTab: NowTabValue) => {
    const normalized = EVENTLOG_TAB_VALUES.includes(nextTab) ? nextTab : 'focus';
    setEventlogLastTab(normalized);
    void navigate({
      to: getEventlogPathForTab(normalized),
      replace: true,
    });
  };

  return (
    <div className="relative flex h-full min-h-full flex-col bg-page dark:bg-page-dark">
      <header className="flex flex-col gap-2 border-b border-[#F0ECE8] px-5 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold leading-[1.5] text-[#1C1917] dark:text-[#FAFAF9]">当下</h1>
        </div>
        <NowViewBar value={activeTab} onChange={handleViewChange} />
      </header>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {activeTab === 'focus' ? (
          <div
            role="tabpanel"
            data-state="active"
            data-testid="now-page-focus-panel"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              <FocusTimerWidget
                prestartSelectedTaskIds={prestartSelectedTaskIds}
                onPrestartSelectedTaskIdsChange={setPrestartSelectedTaskIds}
                showRunningLinkedTasks={false}
              />
              <BlockTaskAssociationList
                prestartSelectedTaskIds={prestartSelectedTaskIds}
                onPrestartSelectedTaskIdsChange={setPrestartSelectedTaskIds}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'record' ? (
          <div
            role="tabpanel"
            data-state="active"
            data-testid="now-page-record-panel"
            className="min-h-0 flex-1 overflow-hidden"
          >
            <ChatPage variant="new-mobile" hideHeader showTimerWidget={false} />
          </div>
        ) : null}

        {activeTab === 'today' ? (
          <div
            role="tabpanel"
            data-state="active"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
          >
            <div className="mx-auto w-full max-w-3xl">
              <NowTodayTab />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
