import type { LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

type PageHeaderNavBaseItem<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
  testId?: string;
};

type PageHeaderNavButtonItem<T extends string> = PageHeaderNavBaseItem<T>;

type PageHeaderNavLinkItem<T extends string> = PageHeaderNavBaseItem<T> & {
  to: string;
  search?: unknown;
  preload?: false | 'intent' | 'viewport' | 'render';
};

type PageHeaderNavButtonsProps<T extends string> = {
  mode: 'buttons';
  activeId: T;
  items: PageHeaderNavButtonItem<T>[];
  onChange: (id: T) => void;
  rootTestId?: string;
  className?: string;
};

type PageHeaderNavLinksProps<T extends string> = {
  mode: 'links';
  activeId: T;
  items: PageHeaderNavLinkItem<T>[];
  navLabel: string;
  rootTestId?: string;
  className?: string;
};

type PageHeaderNavProps<T extends string> =
  | PageHeaderNavButtonsProps<T>
  | PageHeaderNavLinksProps<T>;

function resolveItemClassName(isActive: boolean): string {
  return cn(
    'flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors',
    isActive
      ? 'bg-background text-strong shadow-sm'
      : 'text-secondary hover:bg-background hover:text-strong',
  );
}

function renderItemContent<T extends string>(item: PageHeaderNavBaseItem<T>) {
  const Icon = item.icon;

  return (
    <>
      {Icon ? <Icon size={14} /> : null}
      <span>{item.label}</span>
    </>
  );
}

export function PageHeaderNav<T extends string>(props: PageHeaderNavProps<T>) {
  const rootClassName = cn(
    'flex items-center gap-1 self-start rounded-[10px] border border-border-card bg-card p-1 shadow-sm',
    props.className,
  );

  if (props.mode === 'buttons') {
    return (
      <div data-testid={props.rootTestId} role="tablist" className={rootClassName}>
        {props.items.map((item) => {
          const isActive = item.id === props.activeId;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-testid={item.testId}
              aria-selected={isActive}
              onClick={() => props.onChange(item.id)}
              className={resolveItemClassName(isActive)}
            >
              {renderItemContent(item)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <nav
      data-testid={props.rootTestId}
      aria-label={props.navLabel}
      className={rootClassName}
    >
      {props.items.map((item) => {
        const isActive = item.id === props.activeId;

        return (
          <Link
            key={item.id}
            to={item.to}
            search={item.search as never}
            preload={item.preload ?? 'render'}
            data-testid={item.testId}
            aria-current={isActive ? 'page' : undefined}
            className={resolveItemClassName(isActive)}
          >
            {renderItemContent(item)}
          </Link>
        );
      })}
    </nav>
  );
}
