import { describe, expect, it } from 'vitest';
import { isDesktopAdaptiveShellPath, resolveAppShellMode } from '@/ui/app/layout/shell-mode';

describe('shell-mode', () => {
  it('covers primary app child routes in desktop adaptive shell paths', () => {
    expect(isDesktopAdaptiveShellPath('/')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/eventlog')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/eventlog/timeblocks/block-1')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/tasks')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/tasks/task-1')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/settings')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/settings/legal-support')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/agents')).toBe(true);
    expect(isDesktopAdaptiveShellPath('/agents/chat/abc')).toBe(true);
  });

  it('keeps non-primary routes out of desktop shell matching', () => {
    expect(isDesktopAdaptiveShellPath('/sync-test')).toBe(false);
    expect(isDesktopAdaptiveShellPath('/users')).toBe(false);
    expect(isDesktopAdaptiveShellPath('/volcano-asr-test')).toBe(false);
  });

  it('resolves shell mode from desktop width, adaptive flag, and route scope', () => {
    expect(resolveAppShellMode({
      pathname: '/eventlog/timeblocks/block-1',
      isDesktop: true,
      desktopAdaptiveEnabled: true,
    })).toBe('desktop');

    expect(resolveAppShellMode({
      pathname: '/eventlog/timeblocks/block-1',
      isDesktop: false,
      desktopAdaptiveEnabled: true,
    })).toBe('mobile');

    expect(resolveAppShellMode({
      pathname: '/sync-test',
      isDesktop: true,
      desktopAdaptiveEnabled: true,
    })).toBe('mobile');

    expect(resolveAppShellMode({
      pathname: '/tasks/task-1',
      isDesktop: true,
      desktopAdaptiveEnabled: false,
    })).toBe('mobile');
  });
});
