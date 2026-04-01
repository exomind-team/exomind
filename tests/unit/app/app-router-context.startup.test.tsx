import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import App from '@/App';

const destroyVoiceShortcutService = vi.fn();
const destroyMainWindowShortcutService = vi.fn();
const initNowWorkbenchOverlayServiceMock = vi.fn();
const destroyNowWorkbenchOverlayServiceMock = vi.fn();

vi.mock('@/routes', async () => {
  const React = await import('react');
  const {
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
  } = await import('@tanstack/react-router');

  const rootRoute = createRootRoute({
    component: () => React.createElement(Outlet),
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => React.createElement('div', null, 'mock-home'),
  });

  return {
    appRouter: createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
    }),
  };
});

vi.mock('@/components/ThemeController', () => ({
  ThemeController: () => null,
}));

vi.mock('@/components/ui/toaster', () => ({
  Toaster: () => null,
}));

vi.mock('@/ui/app/components/TimeBlockSyncCoordinator', () => ({
  TimeBlockSyncCoordinator: () => null,
}));

vi.mock('@/ui/app/components/TaskSyncCoordinator', () => ({
  TaskSyncCoordinator: () => null,
}));

vi.mock('@/ui/app/components/ReminderSyncCoordinator', () => ({
  ReminderSyncCoordinator: () => null,
}));

vi.mock('@/ui/app/components/RtDomainBackfillCoordinator', () => ({
  RtDomainBackfillCoordinator: () => null,
}));

vi.mock('@/ui/hooks/useSignalStream', () => ({
  useSignalStream: vi.fn(),
}));

vi.mock('@/services/voice-shortcut.service', () => ({
  initVoiceShortcutService: vi.fn(),
  getVoiceShortcutService: vi.fn(() => ({
    destroy: destroyVoiceShortcutService,
  })),
}));

vi.mock('@/services/main-window-shortcut.service', () => ({
  initMainWindowShortcutService: vi.fn(),
  getMainWindowShortcutService: vi.fn(() => ({
    destroy: destroyMainWindowShortcutService,
  })),
}));

vi.mock('@/services/now-workbench-overlay.service', () => ({
  getNowWorkbenchOverlayService: vi.fn(() => ({
    init: initNowWorkbenchOverlayServiceMock,
    destroy: destroyNowWorkbenchOverlayServiceMock,
  })),
}));

vi.mock('@/ui/stores/update-store', () => ({
  initUpdateChecker: vi.fn(),
  destroyUpdateChecker: vi.fn(),
  useUpdateStore: vi.fn((selector: (state: {
    updateAvailable: null;
    toastDismissed: boolean;
    dismissToast: () => void;
  }) => unknown) => selector({
    updateAvailable: null,
    toastDismissed: false,
    dismissToast: vi.fn(),
  })),
}));

function hasRouterContextWarning(
  calls: unknown[][],
  fragment = 'useRouter must be used inside a <RouterProvider> component!'
): boolean {
  return calls.some((call) =>
    call.some((value) =>
      typeof value === 'string' && value.includes(fragment)
    )
  );
}

describe('App startup router context', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    destroyVoiceShortcutService.mockReset();
    destroyMainWindowShortcutService.mockReset();
    initNowWorkbenchOverlayServiceMock.mockReset();
    destroyNowWorkbenchOverlayServiceMock.mockReset();
  });

  it('renders without router-context warnings for startup overlays（启动期覆盖层不应脱离 RouterProvider）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<App />);

    await screen.findByText('mock-home');

    expect(hasRouterContextWarning(warnSpy.mock.calls)).toBe(false);
    expect(hasRouterContextWarning(errorSpy.mock.calls)).toBe(false);
  });

  it('does not mount legacy TaskSyncCoordinator after RT task cutover（任务切到 RT 后不再挂载旧同步协调器）', () => {
    const source = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
    expect(source).not.toContain('TaskSyncCoordinator');
  });

  it('does not mount legacy ReminderSyncCoordinator after RT cutover（主应用入口不再挂载旧 Reminder 同步协调器）', () => {
    const source = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
    expect(source).not.toContain('ReminderSyncCoordinator');
  });

  it('initializes and disposes now overlay service on startup（启动时初始化并释放当下悬浮工作台服务）', async () => {
    initNowWorkbenchOverlayServiceMock.mockResolvedValue(undefined);
    const { unmount } = render(<App />);

    await screen.findByText('mock-home');
    expect(initNowWorkbenchOverlayServiceMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(destroyNowWorkbenchOverlayServiceMock).toHaveBeenCalled();
  });
});
