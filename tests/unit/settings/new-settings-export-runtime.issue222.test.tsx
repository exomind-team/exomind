import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  exportEventsAsJson: vi.fn(),
  importEventsFromJson: vi.fn(),
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: mocks.exportEventsAsJson,
    importEventsFromJson: mocks.importEventsFromJson,
  }),
}));

vi.mock('@/config/port-env', () => ({
  getSyncServerUrlOverride: () => null,
  resolveSyncServerUrl: () => 'http://127.0.0.1:6984',
  setSyncServerUrlOverride: vi.fn(),
}));

vi.mock('@/config/theme', () => ({
  getThemePreference: () => 'system',
  setThemePreference: vi.fn(),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => false,
  setDeveloperModeEnabled: vi.fn(),
}));

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: () => false,
  setAgentPageEnabled: vi.fn(),
}));

vi.mock('@/config/mock-data', () => ({
  getUseMockDataEnabled: () => false,
  setUseMockDataEnabled: vi.fn(),
  subscribeUseMockDataChanges: () => () => {},
}));

vi.mock('@/config/timer-preferences', () => ({
  getTimerPreferences: () => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: false,
    countdownEndSoundPresetId: 'timer-end-ring-10',
  }),
  subscribeTimerPreferencesChanges: () => () => {},
  updateTimerPreferences: (partial: Record<string, unknown>) => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: false,
    countdownEndSoundPresetId: 'timer-end-ring-10',
    ...partial,
  }),
}));

vi.mock('@/ui/new/components/UserCard', () => ({
  UserCard: () => <div data-testid="mock-user-card" />,
}));

vi.mock('@/ui/new/components/MoreSection', () => ({
  MoreSection: () => null,
}));

vi.mock('@/ui/new/components/LegalSection', () => ({
  LegalSection: () => null,
}));

vi.mock('@/ui/new/components/AboutSection', () => ({
  AboutSection: () => null,
}));

import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

const createObjectURLMock = vi.fn(() => 'blob:mock');
const revokeObjectURLMock = vi.fn();

Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
});

describe('NewSettingsPage export/import runtime routing (issue-222)', () => {
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exportEventsAsJson.mockResolvedValue(JSON.stringify({ events: [{ id: 'evt-1' }] }));
    mocks.importEventsFromJson.mockResolvedValue({ imported: 0, skipped: 0, total: 0 });
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    anchorClickSpy.mockRestore();
  });

  it('uses tauri native save command for export in tauri runtime', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue('/storage/emulated/0/Download/exomind-eventlog-2026-02-24.json');

    render(<NewSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出备份' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('save_json_file', expect.objectContaining({
        content: expect.stringContaining('"events"'),
        defaultName: expect.stringMatching(/^exomind-eventlog-\d{4}-\d{2}-\d{2}\.json$/),
      }));
    });

    expect(screen.getByText(/导出成功，共 1 条事件。保存路径：/)).toBeInTheDocument();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('keeps blob download fallback in web runtime', async () => {
    mocks.isTauri.mockResolvedValue(false);

    render(<NewSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出备份' }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    });

    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByText('导出成功，共 1 条事件。')).toBeInTheDocument();
  });

  it('uses tauri native pick command for import in tauri runtime', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'pick_json_file') {
        return Promise.resolve({
          path: 'content://downloads/document/eventlog.json',
          content: JSON.stringify({
            version: 1,
            events: [
              { id: 'evt-2', timestamp: 1700000000001, content: 'hello', tags: ['note'] },
            ],
          }),
        });
      }
      return Promise.resolve(null);
    });
    mocks.importEventsFromJson.mockResolvedValue({ imported: 1, skipped: 0, total: 2 });

    render(<NewSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('pick_json_file');
    });

    expect(mocks.importEventsFromJson).toHaveBeenCalledWith(expect.stringContaining('"version":1'), 'merge');
    expect(screen.getByText(/导入成功：新增 1 条/)).toBeInTheDocument();
    expect(screen.getByText(/来源：content:\/\/downloads\/document\/eventlog\.json/)).toBeInTheDocument();
  });
});
