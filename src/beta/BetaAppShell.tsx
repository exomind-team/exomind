import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Target, Waypoints } from 'lucide-react';
import { AlphaDesktopShellView, AlphaDesktopSidebarView, AlphaMobileShellView } from '@/ui/app/components/AlphaAppShellView';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

export type BetaSection = 'now' | 'sync' | 'settings';
const NAVIGATION = [
  { key: 'now' as const, title: '当下', icon: Target },
  { key: 'sync' as const, title: '同步', icon: Waypoints },
  { key: 'settings' as const, title: '设置', icon: Settings },
];
const SIDEBAR_KEY = 'exomind:beta:sidebar-collapsed';
export function BetaAppShell({ section, onSectionChange, profileName, onProfileClick, now, sync, settings }: {
  section: BetaSection;
  onSectionChange: (section: BetaSection) => void;
  profileName: string;
  onProfileClick: () => void;
  now: ReactNode;
  sync: ReactNode;
  settings: ReactNode;
}) {
  const desktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; } });
  const [preferenceError, setPreferenceError] = useState('');
  const [workspaceHost] = useState(() => {
    const host = document.createElement('div'); host.className = 'h-full min-h-0 overflow-hidden'; return host;
  });
  const mountPoint = useRef<HTMLDivElement | null>(null);
  const activeBeforeLayout = useRef<HTMLElement | null>(null);
  activeBeforeLayout.current = document.activeElement instanceof HTMLElement && workspaceHost.contains(document.activeElement) ? document.activeElement : null;
  const attachWorkspace = useCallback((node: HTMLDivElement | null) => {
    mountPoint.current = node;
    if (!node) return;
    node.append(workspaceHost);
    const active = activeBeforeLayout.current;
    if (active && workspaceHost.contains(active)) active.focus({ preventScroll: true });
  }, [workspaceHost]);
  // A breakpoint changes only the shell's placement. The sole writer/Chat
  // portal keeps its identity and Web Lock while moving between shell mains.
  useEffect(() => { mountPoint.current?.append(workspaceHost); return () => workspaceHost.remove(); }, [workspaceHost]);
  const items = NAVIGATION.map(item => ({ ...item, active: section === item.key }));
  const select = (next: BetaSection) => {
    if (next === section) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-beta-view]')) active.blur();
    onSectionChange(next);
  };
  const content = <>
    {preferenceError && <p role="alert" className="px-5 py-2 text-xs text-destructive">{preferenceError}</p>}
    {/* Navigation changes visibility, not the sole draft writer's lifecycle. */}
    <section data-beta-view="now" hidden={section !== 'now'} className={section === 'now' ? 'h-full min-h-0 overflow-hidden' : 'hidden'}>{now}</section>
    <section data-beta-view="sync" hidden={section !== 'sync'} className={section === 'sync' ? 'h-full min-h-0 overflow-hidden' : 'hidden'}>{sync}</section>
    <section data-beta-view="settings" hidden={section !== 'settings'} className={section === 'settings' ? 'h-full min-h-0 overflow-hidden' : 'hidden'}>{settings}</section>
  </>;
  const renderNavigationItem = (item: typeof items[number], view: { className: string; children: ReactNode; testId?: string }) =>
    <button type="button" data-testid={view.testId} aria-label={item.title} aria-current={item.active ? 'page' : undefined} title={item.title} className={view.className} onClick={() => select(item.key)}>{view.children}</button>;
  const slot=<div ref={attachWorkspace} className="h-full min-h-0 overflow-hidden"/>;
  const shell=!desktop?<AlphaMobileShellView items={items} fillContainer renderNavigationItem={renderNavigationItem}>{slot}</AlphaMobileShellView>
    :<AlphaDesktopShellView fillContainer sidebar={<AlphaDesktopSidebarView items={items} collapsed={collapsed}
    subtitle="外心 · Beta" renderNavigationItem={renderNavigationItem}
    onToggleCollapsed={() => {
      try { localStorage.setItem(SIDEBAR_KEY, String(!collapsed)); setCollapsed(!collapsed); setPreferenceError(''); }
      catch { setPreferenceError('侧边栏显示设置未能保存，请稍后重试'); }
    }}
    footer={<button type="button" aria-label={`打开档案：${profileName || '未打开档案'}`} onClick={onProfileClick} className={collapsed ? 'flex w-full justify-center rounded-md px-2 py-2 transition-colors hover:bg-[hsl(var(--sidebar-accent))]' : 'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[hsl(var(--sidebar-accent))]'}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--sidebar-accent))] text-xs font-semibold text-[hsl(var(--sidebar-accent-foreground))]" aria-hidden="true">{profileName.trim().charAt(0) || '?'}</div>
      {!collapsed && <div className="min-w-0"><p className="truncate text-sm font-medium">{profileName || '未打开档案'}</p><p className="truncate text-xs text-[hsl(var(--sidebar-muted))]">本机档案</p></div>}
    </button>}/>}>{slot}</AlphaDesktopShellView>;
  return <>{shell}{createPortal(content, workspaceHost, 'beta-workspace')}</>;
}
