export type AppShellMode = 'desktop' | 'mobile';

export function isDesktopAdaptiveShellPath(pathname: string): boolean {
  return pathname === '/'
    || pathname === '/eventlog'
    || pathname.startsWith('/eventlog/')
    || pathname === '/dashboard'
    || pathname === '/tasks'
    || pathname.startsWith('/tasks/')
    || pathname === '/reminders'
    || pathname === '/me'
    || pathname === '/update'
    || pathname === '/settings'
    || pathname.startsWith('/settings/')
    || pathname === '/agents'
    || pathname.startsWith('/agents/')
    || pathname === '/workbench'
    || pathname.startsWith('/workbench/')
    || pathname === '/goals'
    || pathname.startsWith('/goals/');
}

export function resolveAppShellMode({
  pathname,
  isDesktop,
  desktopAdaptiveEnabled,
}: {
  pathname: string;
  isDesktop: boolean;
  desktopAdaptiveEnabled: boolean;
}): AppShellMode {
  return isDesktop && desktopAdaptiveEnabled && isDesktopAdaptiveShellPath(pathname)
    ? 'desktop'
    : 'mobile';
}
