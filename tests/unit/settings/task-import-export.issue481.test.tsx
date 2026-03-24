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

const createObjectURLMock = vi.fn(() => 'blob:task-backup');
const revokeObjectURLMock = vi.fn();

Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
});

describe('SettingsPage task import/export (issue-481)', () => {
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
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

    settingsPageServiceMocks.taskBackup.exportTasksAsJson.mockResolvedValue({
      fileName: 'exomind-tasks-2026-03-11.json',
      content: JSON.stringify({ version: 1, tasks: [] }),
      taskCount: 0,
    });
    settingsPageServiceMocks.taskBackup.exportTasksAsSqliteSnapshot.mockResolvedValue({
      fileName: 'exomind-tasks.sqlite',
      bytes: new Uint8Array([1, 2, 3]),
      taskCount: 1,
    });
    settingsPageServiceMocks.taskBackup.importTasksFromJson.mockResolvedValue({
      imported: 1,
      skipped: 0,
      total: 1,
    });
    settingsPageServiceMocks.taskBackup.importTasksFromSqliteSnapshot.mockResolvedValue({
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

  function selectTaskDomain(): void {
    fireEvent.click(screen.getByRole('button', { name: /任务 导入或导出任务与其 RT SQLite 快照/ }));
  }

  it('exports task backup as JSON from the unified data dialog', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTaskDomain();
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(settingsPageServiceMocks.taskBackup.exportTasksAsJson).toHaveBeenCalledTimes(1);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('任务导出成功（JSON），共 0 条任务。')).toBeInTheDocument();
  });

  it('uses tauri native save command for task JSON export', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue('D:/Downloads/exomind-tasks-2026-03-11.json');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTaskDomain();
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith('save_json_file', {
        content: JSON.stringify({ version: 1, tasks: [] }),
        defaultName: 'exomind-tasks-2026-03-11.json',
      });
    });
    expect(anchorClickSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/任务导出成功（JSON），共 0 条任务。保存路径：/)).toBeInTheDocument();
  });

  it('exports task backup as SQLite snapshot from the unified data dialog', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTaskDomain();
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(settingsPageServiceMocks.taskBackup.exportTasksAsSqliteSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('任务导出成功（SQLite），共 1 条任务。')).toBeInTheDocument();
  });

  it('uses tauri native save command for task SQLite export', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue('D:/Downloads/exomind-tasks.sqlite');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTaskDomain();
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith('save_binary_file', {
        content: [1, 2, 3],
        defaultName: 'exomind-tasks.sqlite',
        filters: ['sqlite', 'db'],
      });
    });
    expect(screen.getByText(/任务导出成功（SQLite），共 1 条任务。保存路径：/)).toBeInTheDocument();
  });

  it('imports task backup from JSON file through the shared input', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    selectTaskDomain();
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 1, tasks: [] })], 'tasks.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.taskBackup.importTasksFromJson).toHaveBeenCalledWith(
        expect.stringContaining('"tasks"'),
        'merge',
      );
    });
    expect(screen.getByText(/任务导入成功：新增 1 条/)).toBeInTheDocument();
  });

  it('imports task backup from SQLite snapshot file through the shared input', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    selectTaskDomain();
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'tasks.sqlite', {
      type: 'application/octet-stream',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.taskBackup.importTasksFromSqliteSnapshot).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'merge',
      );
    });
    expect(screen.getByText(/任务导入成功：新增 2 条/)).toBeInTheDocument();
  });
});
