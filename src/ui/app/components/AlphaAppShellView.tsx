import { Tooltip } from '@/components/ui/tooltip';
import { Fragment, type ReactNode } from 'react';
import { Brain, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AppShellNavigationItem {
  key: string;
  title: string;
  icon: LucideIcon;
  active: boolean;
}
interface NavigationItemView {
  className: string;
  children: ReactNode;
  testId?: string;
}
type NavigationRenderer<T extends AppShellNavigationItem> = (item: T, view: NavigationItemView) => ReactNode;

/** The existing α router's presentation only. Route/store/window ownership stays
 * with its caller; the isolated Beta entry does not import the legacy router. */
export function AlphaDesktopSidebarView<T extends AppShellNavigationItem>({
  items, collapsed, onToggleCollapsed, footer, renderNavigationItem, subtitle = '外心', brand,
}: {
  items: T[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  footer: ReactNode;
  renderNavigationItem: NavigationRenderer<T>;
  subtitle?: ReactNode;
  brand?: ReactNode;
}) {
  return <aside data-testid="desktop-sidebar" data-state={collapsed ? 'collapsed' : 'expanded'}
    className={cn('flex h-full shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] transition-[width] duration-200 ease-out', collapsed ? 'w-16' : 'w-64')}>
    <div className={cn('border-b border-[hsl(var(--sidebar-border))]', collapsed ? 'p-2' : 'p-3')}>
      {brand ? <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'}`}>
        <Tooltip content={collapsed ? '展开侧边栏' : '收起侧边栏'}><button type="button" data-testid="desktop-sidebar-toggle" aria-label="收起侧边栏" aria-pressed={collapsed} aria-expanded={!collapsed}  onClick={onToggleCollapsed}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-[hsl(var(--sidebar-accent))] focus-visible:ring-2 focus-visible:ring-ring">{brand}</button></Tooltip>
        {!collapsed && <Tooltip content={typeof subtitle === 'string' ? subtitle : undefined}><p className="min-w-0 truncate text-xs font-medium"  tabIndex={0}>{subtitle}</p></Tooltip>}
      </div> : collapsed ? <div className="flex flex-col items-center gap-2 rounded-md py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]"><Brain size={16}/></div>
        <button type="button" data-testid="desktop-sidebar-toggle" aria-label="展开侧边栏" aria-expanded="false" onClick={onToggleCollapsed}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[hsl(var(--sidebar-border))] text-[hsl(var(--sidebar-muted))] transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]"><PanelLeftOpen size={16}/></button>
      </div> : <div className="flex items-center gap-3 rounded-md px-2 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]"><Brain size={16}/></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">ExoMind</p><p className="truncate text-xs text-[hsl(var(--sidebar-muted))]">{subtitle}</p></div>
        <button type="button" data-testid="desktop-sidebar-toggle" aria-label="收起侧边栏" aria-expanded="true" onClick={onToggleCollapsed}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--sidebar-border))] text-[hsl(var(--sidebar-muted))] transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]"><PanelLeftClose size={16}/></button>
      </div>}
    </div>
    <nav className="flex-1 space-y-1 p-2">{items.map(item => {
      const Icon = item.icon;
      return <Fragment key={item.key}>{renderNavigationItem(item, {
        testId: `desktop-sidebar-item-${item.key}`,
        className: cn('relative flex w-full items-center rounded-md text-sm transition-colors', collapsed ? 'justify-center px-0 py-3' : 'gap-2 px-3 py-2', item.active ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))] font-medium' : 'text-[hsl(var(--sidebar-foreground))]'),
        children: <><Icon size={16}/>{collapsed ? <span className="sr-only">{item.title}</span> : <span>{item.title}</span>}</>,
      })}</Fragment>;
    })}</nav>
    <div className={cn('border-t border-[hsl(var(--sidebar-border))]', collapsed ? 'p-2' : 'p-3')}>{footer}</div>
  </aside>;
}

export function AlphaMobileShellView<T extends AppShellNavigationItem>({
  items, renderNavigationItem, children, previewFrame = false, fullscreen = false,
  commandPalette, fillContainer = false,
}: {
  items: T[];
  renderNavigationItem: NavigationRenderer<T>;
  children: ReactNode;
  previewFrame?: boolean;
  fullscreen?: boolean;
  commandPalette?: ReactNode;
  /** A native status notice may reserve part of Beta's viewport. */
  fillContainer?: boolean;
}) {
  return <div className={cn(fillContainer ? 'h-full min-h-0' : 'min-h-[100dvh]', 'bg-[#ECE6E1] dark:bg-[#0C0A09]', previewFrame && 'p-6')}>
    <div className={cn('relative w-full overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]', fillContainer ? 'h-full' : 'h-[100dvh]', previewFrame && 'mx-auto max-w-[393px] h-[852px] rounded-[40px] border border-[#E6DFD8] dark:border-[#292524] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]')}>
      <main className={cn('absolute inset-x-0 overflow-y-auto', fullscreen && 'scrollbar-none', fullscreen ? (previewFrame ? 'top-0 bottom-0' : 'top-[env(safe-area-inset-top,0px)] bottom-0') : cn('bottom-[calc(env(safe-area-inset-bottom,0px)+60px)]', previewFrame ? 'top-0' : 'top-[env(safe-area-inset-top,0px)]'))}>{children}</main>
      {commandPalette}
      {!fullscreen && <nav data-testid="mobile-bottom-tab" className="absolute inset-x-0 bottom-0 z-40 border-t border-[#E4DED7] dark:border-[#292524] bg-[#FAF7F5]/95 dark:bg-[#0C0A09]/95 backdrop-blur">
        <div className="flex items-center px-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2">{items.map(item => {
          const Icon = item.icon;
          return <Fragment key={item.key}>{renderNavigationItem(item, {
            className: cn('flex flex-1 min-w-0 flex-col items-center gap-1 rounded-xl py-1 text-[11px] transition-colors', item.active ? 'text-[#C75B3A] dark:text-[#E8734E] font-semibold' : 'text-stone-400 dark:text-[#57534E]'),
            children: <><Icon size={20}/><span>{item.title}</span></>,
          })}</Fragment>;
        })}</div>
      </nav>}
    </div>
  </div>;
}

export function AlphaDesktopShellView({ sidebar, children, fillContainer = false }: {
  sidebar: ReactNode;
  children: ReactNode;
  fillContainer?: boolean;
}) {
  return <div className={cn(fillContainer ? 'h-full' : 'h-[100dvh]', 'overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]')}>
    <div className="flex h-full w-full overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]">
      {sidebar}
      <main data-testid="desktop-settings-content" className="min-w-0 flex-1 overflow-y-auto bg-[#FAF7F5] dark:bg-[#0C0A09]">{children}</main>
    </div>
  </div>;
}
