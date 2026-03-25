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

describe('SettingsPage all-data transfer option (issue-506)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'rt-sqlite';
    settingsPageDomainBackendState.timeblock = 'rt-sqlite';
    (window as { __TAURI__?: { __VERSION__: string } }).__TAURI__ = { __VERSION__: '2.0.0' };
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue(null);
    settingsPageServiceMocks.dataTransfer.exportBackup.mockResolvedValue('全部数据导出成功。');
    settingsPageServiceMocks.dataTransfer.importBackup.mockResolvedValue('全部数据导入成功。');
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
  });

  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it('shows all-data range and updated timeblock copy（显示全部数据范围与已迁移时间块文案）', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '导出数据' }));

    expect(screen.getByRole('button', { name: /全部数据 将事件日志、任务与时间块一起打包到单个文件。/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /时间块 导入或导出时间块与当前进行中时间块快照。/ })).toBeInTheDocument();
  });

  it('exports all domains through one JSON bundle（通过单个 JSON 文件导出全部域）', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '导出数据' }));
    fireEvent.click(screen.getByRole('button', { name: /全部数据 将事件日志、任务与时间块一起打包到单个文件。/ }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(settingsPageServiceMocks.dataTransfer.exportBackup).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('全部数据导出成功。')).toBeInTheDocument();
  });

  it('disables SQLite when exporting all domains（导出全部域时禁用 SQLite）', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '导出数据' }));
    fireEvent.click(screen.getByRole('button', { name: /全部数据 将事件日志、任务与时间块一起打包到单个文件。/ }));
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));

    expect(screen.getByText('全部数据当前仅支持 JSON 打包导入导出。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始导出' })).toBeDisabled();
  });

  it('imports all domains through one JSON bundle（通过单个 JSON 文件导入全部域）', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '导入数据' }));
    fireEvent.click(screen.getByRole('button', { name: /全部数据 将事件日志、任务与时间块一起打包到单个文件。/ }));
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 3, events: [], tasks: [], time_blocks: [], active_block: null })], 'all-data.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.dataTransfer.importBackup).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('全部数据导入成功。')).toBeInTheDocument();
  });
});
