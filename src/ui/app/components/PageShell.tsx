import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageShellProps {
  title: string;
  headerTop?: ReactNode;
  eyebrow?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  headerBottom?: ReactNode;
  children: ReactNode;
  hideHeader?: boolean;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
}

export function PageShell({
  title,
  headerTop,
  eyebrow,
  subtitle,
  headerAction,
  headerBottom,
  children,
  hideHeader = false,
  className,
  contentClassName,
  headerClassName,
}: PageShellProps) {
  return (
    <div
      data-testid="page-shell-root"
      className={cn('flex h-full min-h-full flex-col bg-page dark:bg-page-dark', className)}
    >
      {!hideHeader ? (
        <header
          className={cn(
            'flex flex-col gap-2 border-b border-border-page px-5 py-3 md:px-8 lg:px-10',
            headerClassName,
          )}
        >
          {headerTop ? <div className="min-w-0">{headerTop}</div> : null}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {eyebrow ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-secondary">{eyebrow}</p>
              ) : null}
              <h1 className={cn('text-lg font-semibold leading-[1.5] text-foreground', eyebrow ? 'mt-1' : undefined)}>{title}</h1>
              {subtitle ? (
                <p className="mt-1 text-sm text-secondary">{subtitle}</p>
              ) : null}
            </div>
            {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
          </div>
          {headerBottom ? <div className="min-w-0">{headerBottom}</div> : null}
        </header>
      ) : null}
      <div className={cn('min-h-0 flex-1', contentClassName)}>{children}</div>
    </div>
  );
}
