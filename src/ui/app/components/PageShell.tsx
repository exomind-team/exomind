import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageShellProps {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  hideHeader?: boolean;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
}

export function PageShell({
  title,
  subtitle,
  headerAction,
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
            'flex items-center justify-between gap-3 border-b border-border-page px-5 py-3 md:px-8 lg:px-10',
            headerClassName,
          )}
        >
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-xs text-secondary">{subtitle}</p>
            ) : null}
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </header>
      ) : null}
      <div className={cn('min-h-0 flex-1', contentClassName)}>{children}</div>
    </div>
  );
}
