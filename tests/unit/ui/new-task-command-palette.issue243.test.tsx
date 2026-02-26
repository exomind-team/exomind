import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewTasksPage } from '@/ui/new/pages/NewTasksPage';

const openPaletteMock = vi.fn();
const listTasksMock = vi.fn();
const longTermGoalsMock = vi.fn();

const runtimeFlags = vi.hoisted(() => ({
  developerModeEnabled: true,
  commandPaletteEnabled: true,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    getLongTermGoals: longTermGoalsMock,
    createTask: vi.fn(),
    getTask: vi.fn(),
    setTimerMode: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    upsertTask: vi.fn(),
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
    longTermGoalsMock.mockResolvedValue([]);
    runtimeFlags.developerModeEnabled = true;
    runtimeFlags.commandPaletteEnabled = true;
  });

  it('shows command palette entry when feature is active（功能开启时展示入口）', async () => {
    render(<NewTasksPage />);
    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
      expect(longTermGoalsMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '更多菜单' }));
    const entry = screen.getByTestId('page-more-menu-open-command-palette');
    expect(entry).toBeInTheDocument();

    fireEvent.click(entry);
    expect(openPaletteMock).toHaveBeenCalledTimes(1);
  });

  it('hides command palette entry when feature is disabled（功能关闭时隐藏入口）', async () => {
    runtimeFlags.commandPaletteEnabled = false;
    render(<NewTasksPage />);
    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
      expect(longTermGoalsMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '更多菜单' }));
    expect(screen.queryByTestId('page-more-menu-open-command-palette')).not.toBeInTheDocument();
  });
});
