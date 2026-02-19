import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  exportEventsAsJson: vi.fn(),
  importEventsFromJson: vi.fn(),
  setSyncServerUrlOverride: vi.fn(),
  setThemePreference: vi.fn(),
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: mocks.exportEventsAsJson,
    importEventsFromJson: mocks.importEventsFromJson,
  }),
}));

vi.mock('@/config/port-env', () => ({
  getSyncServerUrlOverride: () => null,
  resolveSyncServerUrl: () => 'http://127.0.0.1:3001',
  setSyncServerUrlOverride: mocks.setSyncServerUrlOverride,
}));

vi.mock('@/config/theme', () => ({
  getThemePreference: () => 'system',
  setThemePreference: mocks.setThemePreference,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

import { SettingsPage } from '@/components/Settings/SettingsPage';

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

describe('SettingsPage export runtime routing', () => {
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

  it('uses tauri native save command in tauri runtime', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue('C:\\Exports\\exomind-eventlog-2026-02-18.json');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('save_json_file', expect.objectContaining({
        content: expect.stringContaining('"events"'),
        defaultName: expect.stringMatching(/^exomind-eventlog-\d{4}-\d{2}-\d{2}\.json$/),
      }));
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('导出成功，共 1 条事件。');
    expect(status.textContent).toContain('保存路径');
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('keeps blob download behavior in web runtime', async () => {
    mocks.isTauri.mockResolvedValue(false);

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    });

    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('导出成功，共 1 条事件。');
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

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入 JSON' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('pick_json_file');
    });

    expect(mocks.importEventsFromJson).toHaveBeenCalledWith(
      expect.stringContaining('"version":1'),
      'merge',
    );
    expect(screen.getByRole('status').textContent).toContain('导入成功：新增 1 条');
  });
});
