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

const createObjectURLMock = vi.fn(() => 'blob:eventlog-backup');
const revokeObjectURLMock = vi.fn();

Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
});

describe('SettingsPage eventlog import/export (issue-484)', () => {
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'rt-sqlite';
    settingsPageDomainBackendState.timeblock = 'legacy';
    (window as { __TAURI__?: { __VERSION__: string } }).__TAURI__ = { __VERSION__: '2.0.0' };
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
    settingsPageServiceMocks.eventlogBackup.exportEventsAsSqliteSnapshot.mockResolvedValue({
      fileName: 'exomind-eventlog.sqlite',
      bytes: new Uint8Array([9, 8, 7]),
      eventCount: 2,
    });
    settingsPageServiceMocks.eventlogBackup.importEventsFromJson.mockResolvedValue({
      imported: 1,
      skipped: 0,
      total: 1,
    });
    settingsPageServiceMocks.eventlogBackup.importEventsFromSqliteSnapshot.mockResolvedValue({
      imported: 2,
      skipped: 0,
      total: 2,
    });
    tauriMocks.isTauri.mockResolvedValue(false);
    tauriMocks.invoke.mockResolvedValue(null);
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    anchorClickSpy.mockRestore();
  });

  it('uses a unified data export/import entry instead of legacy per-domain buttons', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: '导出数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入数据' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出任务 JSON' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出任务 SQLite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导入任务数据' })).not.toBeInTheDocument();
  });

  it('exports eventlog JSON through the unified dialog and tauri native save command', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue('D:/Downloads/exomind-eventlog-2026-03-11.json');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    fireEvent.click(screen.getByRole('button', { name: /事件日志 导入或导出语音输入/ }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(settingsPageServiceMocks.eventlogBackup.exportEventsAsJson).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith('save_json_file', {
      content: JSON.stringify({ version: 1, events: [{ id: 'evt-1' }] }),
      defaultName: 'exomind-eventlog-2026-03-11.json',
    });
    expect(anchorClickSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/事件日志导出成功（JSON），共 1 条事件。保存路径：/)).toBeInTheDocument();
  });

  it('exports eventlog SQLite through the unified dialog', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue('D:/Downloads/exomind-eventlog.sqlite');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(settingsPageServiceMocks.eventlogBackup.exportEventsAsSqliteSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith('save_binary_file', {
      content: [9, 8, 7],
      defaultName: 'exomind-eventlog.sqlite',
      filters: ['sqlite', 'db'],
    });
    expect(screen.getByText(/事件日志导出成功（SQLite），共 2 条事件。保存路径：/)).toBeInTheDocument();
  });

  it('imports eventlog JSON through the unified dialog and shared file input', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 1, events: [] })], 'eventlog.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.eventlogBackup.importEventsFromJson).toHaveBeenCalledWith(
        expect.stringContaining('"events"'),
        'merge',
      );
    });
    expect(screen.getByText(/事件日志导入成功：新增 1 条/)).toBeInTheDocument();
  });

  it('imports eventlog SQLite through the unified dialog and shared file input', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'eventlog.sqlite', {
      type: 'application/octet-stream',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.eventlogBackup.importEventsFromSqliteSnapshot).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'merge',
      );
    });
    expect(screen.getByText(/事件日志导入成功：新增 2 条/)).toBeInTheDocument();
  });
});
