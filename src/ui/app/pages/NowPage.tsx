import { ChatPage } from '@/components/Chat/ChatPage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import { useLocation, useNavigate } from '@tanstack/react-router';

const NOW_TAB_VALUES = ['focus', 'record', 'today'] as const;
type NowTabValue = (typeof NOW_TAB_VALUES)[number];

function resolveNowTab(searchStr: string): NowTabValue {
  const searchParams = new URLSearchParams(searchStr);
  const tab = searchParams.get('tab');
  return NOW_TAB_VALUES.includes(tab as NowTabValue) ? (tab as NowTabValue) : 'focus';
}

export function NowPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = resolveNowTab(location.searchStr ?? '');
  const currentPath = location.pathname === '/' ? '/' : '/eventlog';

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]">
      <Tabs
        value={activeTab}
        onValueChange={(nextValue) => {
          const nextTab = NOW_TAB_VALUES.includes(nextValue as NowTabValue) ? (nextValue as NowTabValue) : 'focus';
          void navigate({
            to: currentPath,
            search: nextTab === 'focus' ? {} : { tab: nextTab },
            replace: true,
          });
        }}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="border-b border-[#E7E5E4] px-4 py-3 dark:border-[#292524] md:px-6">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl border border-[#E7E5E4] bg-white p-1 dark:border-[#292524] dark:bg-[#1C1917]">
            <TabsTrigger value="focus" className="rounded-xl text-sm">专注</TabsTrigger>
            <TabsTrigger value="record" className="rounded-xl text-sm">记录</TabsTrigger>
            <TabsTrigger value="today" className="rounded-xl text-sm">今日</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="focus" className="mt-0 min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <FocusTimerWidget />
            <BlockTaskAssociationList />
          </div>
        </TabsContent>

        <TabsContent value="record" className="mt-0 min-h-0 flex-1">
          <ChatPage variant="new-mobile" hideHeader showTimerWidget={false} />
        </TabsContent>

        <TabsContent value="today" className="mt-0 min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <NowTodayTab />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
