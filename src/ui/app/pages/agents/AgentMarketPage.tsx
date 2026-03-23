import { ArrowDownToLine, ArrowLeft, Search, Sparkles, Store, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentMarketCategory, AgentMarketItem } from '@/lib/types/agent-hub';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

function getMarketCardIcon(item: AgentMarketItem) {
  if (item.id.includes('calendar')) return Store;
  if (item.id.includes('knowledge')) return Users;
  return Sparkles;
}

export function AgentMarketPage() {
  const isDesktop = useIsDesktop();
  const [categories, setCategories] = useState<AgentMarketCategory[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [items, setItems] = useState<AgentMarketItem[]>([]);

  useEffect(() => {
    let disposed = false;
    const service = getAgentHubService();
    const load = async () => {
      const [nextCategories, nextItems] = await Promise.all([
        service.listMarketCategories(),
        service.getMarketItems({ categoryId: 'all' }),
      ]);
      if (disposed) return;
      setCategories(nextCategories);
      setItems(nextItems);
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const handleCategoryChange = async (categoryId: string) => {
    setActiveCategoryId(categoryId);
    const nextItems = await getAgentHubService().getMarketItems({ categoryId });
    setItems(nextItems);
  };

  return (
    <div data-testid="agent-market-page" className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09] md:px-8 lg:px-10">
      <header className="grid grid-cols-[auto,1fr,auto] items-center border-b border-[#F0ECE8] px-5 py-3 dark:border-[#292524] md:px-0">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-[12px] text-[#C75B3A]"
        >
          <ArrowLeft size={14} />
          返回
        </button>
        <h1 className="text-center text-[17px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">市场</h1>
        <span />
      </header>

      <div className="px-5 pt-3 md:px-0">
        <label
          data-testid="agent-market-search"
          className="flex items-center gap-2 rounded-xl bg-[#F5F0ED] px-3 py-2 text-sm text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
        >
          <Search size={14} />
          搜索 Agent、数据源、知识包...
        </label>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto px-5 pb-1 md:px-0">
        {categories.map((category) => {
          const active = category.id === activeCategoryId;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                void handleCategoryChange(category.id);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] ${
                active ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
              }`}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 px-5 md:px-0">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">热门推荐</h2>
          <span className="text-[13px] text-[#C75B3A]">查看全部</span>
        </div>

        <div className={`mt-2 space-y-3 ${isDesktop ? 'pb-8' : 'pb-[calc(env(safe-area-inset-bottom,0px)+108px)]'}`}>
          {items.map((item) => {
            const Icon = getMarketCardIcon(item);
            return (
              <article key={item.id} className="rounded-2xl border border-[#F5F0ED] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${item.tintColor}20`, color: item.tintColor }}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.name}</p>
                    <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">by exomind team</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">{item.summary}</p>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {item.tags.slice(0, 2).map((tag) => (
                      <span key={`${item.id}-${tag}`} className="rounded bg-[#F5F0ED] px-2 py-0.5 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-[#A8A29E] dark:text-[#78716C]">
                    <ArrowDownToLine size={11} />
                    {item.installsText}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
