import type { ReactNode } from 'react';
import { Children, isValidElement } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface PageTabsProps {
  tabs: Array<{ id: string; label: string; icon?: ReactNode }>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  variant?: 'grid' | 'scroll';
  children: ReactNode;
  className?: string;
  listClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

export function PageTabs({
  tabs,
  activeTab,
  onTabChange,
  variant = 'grid',
  children,
  className,
  listClassName,
  triggerClassName,
  contentClassName,
}: PageTabsProps) {
  const panelChildren = Children.toArray(children)
    .map((child) => {
      if (!isValidElement(child)) {
        return null;
      }

      const panelId = child.props['data-tab-id'];
      if (typeof panelId !== 'string') {
        return null;
      }

      return (
        <TabsContent
          key={panelId}
          value={panelId}
          className={cn('mt-0 min-h-0 flex-1 overflow-hidden', contentClassName)}
        >
          {child}
        </TabsContent>
      );
    })
    .filter(Boolean);

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className={cn('flex min-h-0 flex-col gap-3 overflow-hidden', className)}
    >
      <TabsList
        className={cn(
          variant === 'grid'
            ? 'grid h-auto w-full shrink-0 rounded-xl border border-border-card bg-card p-1 shadow-sm'
            : 'scrollbar-none flex h-auto w-full shrink-0 gap-2 overflow-x-auto rounded-xl border border-border-card bg-card p-1 shadow-sm',
          listClassName,
        )}
        style={variant === 'grid' ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className={cn(
              'h-9 gap-1.5 rounded-lg text-xs text-secondary hover:bg-background hover:text-strong data-[state=active]:bg-background data-[state=active]:text-strong',
              variant === 'grid' ? 'flex-1' : 'shrink-0 px-3',
              triggerClassName,
            )}
          >
            {tab.icon ?? null}
            <span>{tab.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {panelChildren}
    </Tabs>
  );
}
