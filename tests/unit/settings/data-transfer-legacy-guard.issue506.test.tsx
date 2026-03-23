import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('SettingsPage unified data transfer legacy guard (issue-506)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'legacy';
    settingsPageDomainBackendState.timeblock = 'rt-sqlite';
    tauriMocks.isTauri.mockResolvedValue(false);
    tauriMocks.invoke.mockResolvedValue(null);
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
  });

  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  function selectTaskDomain(): void {
    fireEvent.click(screen.getByRole('button', { name: /任务 导入或导出任务与其 RT SQLite 快照/ }));
  }

  it('disables unified export when selected domain backend is legacy', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTaskDomain();

    expect(screen.getByText('legacy 后端暂不支持统一导入导出，请先切换到 rt-sqlite。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始导出' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));
    expect(settingsPageServiceMocks.taskBackup.exportTasksAsJson).not.toHaveBeenCalled();
    expect(settingsPageServiceMocks.taskBackup.exportTasksAsSqliteSnapshot).not.toHaveBeenCalled();
  });

  it('disables unified import when selected domain backend is legacy', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    selectTaskDomain();

    expect(screen.getByText('legacy 后端暂不支持统一导入导出，请先切换到 rt-sqlite。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择文件并导入' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));
    expect(settingsPageServiceMocks.taskBackup.importTasksFromJson).not.toHaveBeenCalled();
    expect(settingsPageServiceMocks.taskBackup.importTasksFromSqliteSnapshot).not.toHaveBeenCalled();
  });

  it('disables unified export outside tauri even when backend preference is rt-sqlite', () => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    settingsPageDomainBackendState.task = 'rt-sqlite';

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTaskDomain();

    expect(screen.getByText('当前环境不支持统一导入导出，请在桌面端使用。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始导出' })).toBeDisabled();
  });
});
