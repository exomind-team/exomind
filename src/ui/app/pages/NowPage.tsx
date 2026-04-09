import { ListTodo, NotebookPen, Target } from 'lucide-react';
import { ChatPage } from '@/components/Chat/ChatPage';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';
import { PageHeaderNav } from '@/ui/app/components/PageHeaderNav';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import { PageShell } from '@/ui/app/components/PageShell';
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
    <PageHeaderNav
      mode="buttons"
      rootTestId="now-page-view-bar"
      activeId={value}
      onChange={onChange}
      items={NOW_VIEW_ITEMS.map((item) => ({
        ...item,
        testId: `now-page-view-toggle-${item.id}`,
      }))}
    />
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
    <PageShell
      title="当下"
      headerBottom={<NowViewBar value={activeTab} onChange={handleViewChange} />}
      contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
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
            <div className="mx-auto w-full max-w-6xl">
              <NowTodayTab />
            </div>
          </div>
        ) : null}
    </PageShell>
  );
}
