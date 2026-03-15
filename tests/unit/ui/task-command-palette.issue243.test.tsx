import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksPage } from '@/ui/app/pages/TasksPage';

const openPaletteMock = vi.fn();
const listTasksMock = vi.fn();

const runtimeFlags = vi.hoisted(() => ({
  developerModeEnabled: true,
  commandPaletteEnabled: true,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(),
    transitionTask: vi.fn(),
    getAvailableTransitions: vi.fn(async () => []),
    getChildTasks: vi.fn(async () => []),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
    startSync: vi.fn(async () => {}),
    stopSync: vi.fn(async () => {}),
    onTaskChange: vi.fn(() => () => {}),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: vi.fn(async () => []),
    loadActiveBlock: vi.fn(async () => null),
    onBlockChange: vi.fn(() => () => {}),
  }),
}));

vi.mock('@/lib/services/command-palette.service', () => ({
  getCommandPaletteService: () => ({
    open: openPaletteMock,
    close: vi.fn(),
    toggle: vi.fn(),
    setQuery: vi.fn(),
    setHighlightedIndex: vi.fn(),
    moveHighlight: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getState: vi.fn(),
  }),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => runtimeFlags.developerModeEnabled,
  subscribeDeveloperModeChanges: () => () => {},
}));

vi.mock('@/config/command-palette-enabled', () => ({
  getCommandPaletteEnabled: () => runtimeFlags.commandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges: () => () => {},
}));

describe('new tasks page command palette entry issue-243（任务页命令面板入口）', () => {
  beforeEach(() => {
    openPaletteMock.mockReset();
    listTasksMock.mockResolvedValue([]);
    runtimeFlags.developerModeEnabled = true;
    runtimeFlags.commandPaletteEnabled = true;
  });

  it('shows command palette entry when feature is active（功能开启时展示入口）', async () => {
    render(<TasksPage />);
    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '更多菜单' }));
    const entry = screen.getByTestId('page-more-menu-open-command-palette');
    expect(entry).toBeInTheDocument();

    fireEvent.click(entry);
    expect(openPaletteMock).toHaveBeenCalledTimes(1);
  });

  it('hides command palette entry when feature is disabled（功能关闭时隐藏入口）', async () => {
    runtimeFlags.commandPaletteEnabled = false;
    render(<TasksPage />);
    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '更多菜单' }));
    expect(screen.queryByTestId('page-more-menu-open-command-palette')).not.toBeInTheDocument();
  });
});
