import { ChatPage } from '@/components/Chat/ChatPage';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import { PageTabs } from '@/ui/app/components/PageTabs';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  EVENTLOG_TAB_VALUES,
  normalizeEventlogTab,
  setEventlogLastTab,
} from '@/ui/app/pages/eventlog-route-memory';

type NowTabValue = (typeof EVENTLOG_TAB_VALUES)[number];

function readExplicitNowTab(searchStr: string): NowTabValue | null {
  const rawValue = new URLSearchParams(searchStr).get('tab');
  return EVENTLOG_TAB_VALUES.includes(rawValue as NowTabValue) ? rawValue as NowTabValue : null;
}

function resolveNowTab(searchStr: string): NowTabValue {
  return normalizeEventlogTab(new URLSearchParams(searchStr).get('tab'));
}

export function NowPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [prestartSelectedTaskIds, setPrestartSelectedTaskIds] = useState<string[]>([]);
  const activeTab = resolveNowTab(location.searchStr ?? '');
  const currentPath = location.pathname === '/' ? '/' : '/eventlog';
  const explicitTab = readExplicitNowTab(location.searchStr ?? '');

  useEffect(() => {
    if (explicitTab) {
      setEventlogLastTab(explicitTab);
    }
  }, [explicitTab]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-page dark:bg-page-dark">
      <PageTabs
        activeTab={activeTab}
        onTabChange={(nextValue) => {
          const nextTab = EVENTLOG_TAB_VALUES.includes(nextValue as NowTabValue) ? (nextValue as NowTabValue) : 'focus';
          setEventlogLastTab(nextTab);
          void navigate({
            to: currentPath,
            search: nextTab === 'focus' ? {} : { tab: nextTab },
            replace: true,
          });
        }}
        tabs={[
          { id: 'focus', label: '专注' },
          { id: 'record', label: '记录' },
          { id: 'today', label: '今日' },
        ]}
        className="flex h-full min-h-0 flex-col"
      >
        <div
          data-tab-id="focus"
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

        <div data-tab-id="record" className="min-h-0 flex-1">
          <ChatPage variant="new-mobile" hideHeader showTimerWidget={false} />
        </div>

        <div data-tab-id="today" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <NowTodayTab />
          </div>
        </div>
      </PageTabs>
    </div>
  );
}
