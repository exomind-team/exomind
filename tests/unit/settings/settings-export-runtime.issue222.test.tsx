import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPageDomainBackendState,
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: tauriMocks.isTauri,
  invoke: tauriMocks.invoke,
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

const createObjectURLMock = vi.fn(() => 'blob:eventlog-runtime');
const revokeObjectURLMock = vi.fn();

Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
});

describe('SettingsPage export/import runtime routing (issue-222)', () => {
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'rt-sqlite';
    settingsPageDomainBackendState.timeblock = 'legacy';
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    settingsPageServiceMocks.eventlogBackup.exportEventsAsJson.mockResolvedValue({
      fileName: 'exomind-eventlog-2026-03-11.json',
      content: JSON.stringify({ version: 1, events: [{ id: 'evt-1' }] }),
      eventCount: 1,
    });
    settingsPageServiceMocks.eventlogBackup.importEventsFromJson.mockResolvedValue({
      imported: 1,
      skipped: 0,
      total: 2,
    });
    tauriMocks.isTauri.mockResolvedValue(false);
    tauriMocks.invoke.mockResolvedValue(null);
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    anchorClickSpy.mockRestore();
  });

  it('uses tauri native save command for eventlog export in tauri runtime', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue('/storage/emulated/0/Download/exomind-eventlog-2026-03-11.json');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith('save_json_file', {
        content: JSON.stringify({ version: 1, events: [{ id: 'evt-1' }] }),
        defaultName: 'exomind-eventlog-2026-03-11.json',
      });
    });

    expect(screen.getByText(/事件日志导出成功（JSON），共 1 条事件。保存路径：/)).toBeInTheDocument();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('keeps blob download fallback in web runtime', async () => {
    tauriMocks.isTauri.mockResolvedValue(false);

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    });

    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByText('事件日志导出成功（JSON），共 1 条事件。')).toBeInTheDocument();
  });

  it('imports eventlog JSON through the shared file picker flow in tauri runtime', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 1, events: [{ id: 'evt-2' }] })], 'eventlog.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.eventlogBackup.importEventsFromJson).toHaveBeenCalledWith(
        expect.stringContaining('"version"'),
        'merge',
      );
    });
    expect(screen.getByText(/事件日志导入成功：新增 1 条/)).toBeInTheDocument();
  });
});
