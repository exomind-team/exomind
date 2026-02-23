import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentMarketCategory, AgentMarketItem } from '@/lib/types/agent-hub';

export function AgentMarketPage() {
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
    <div data-testid="agent-market-page" className="min-h-full bg-[#FAF7F5]">
      <header className="px-5 py-3">
        <h1 className="text-[17px] font-bold text-[#1C1917]">市场</h1>
      </header>

      <div className="px-5">
        <div className="rounded-xl bg-[#F5F0ED] px-4 py-2 text-sm text-[#A8A29E]">搜索 Agent、数据源、知识包...</div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
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
                active ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C]'
              }`}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 px-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-[#1C1917]">热门推荐</h2>
          <span className="text-[13px] text-[#C75B3A]">查看全部</span>
        </div>

        <div className="mt-2 space-y-3 pb-[calc(env(safe-area-inset-bottom,0px)+108px)]">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-[#F5F0ED] bg-white p-4">
              <p className="text-sm font-semibold text-[#1C1917]">{item.name}</p>
              <p className="mt-1 text-xs text-[#78716C]">{item.summary}</p>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <span key={`${item.id}-${tag}`} className="rounded bg-[#F5F0ED] px-2 py-0.5 text-[11px] text-[#78716C]">
                      {tag}
                    </span>
                  ))}
                </div>
                <span className="text-[11px] text-[#A8A29E]">{item.installsText}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

