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

const createObjectURLMock = vi.fn(() => 'blob:timeblock-backup');
const revokeObjectURLMock = vi.fn();

Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
});

describe('SettingsPage timeblock import/export (issue-485)', () => {
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'rt-sqlite';
    settingsPageDomainBackendState.timeblock = 'rt-sqlite';
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

    settingsPageServiceMocks.timeblockBackup.exportTimeBlocksAsJson.mockResolvedValue({
      fileName: 'exomind-timeblocks-2026-03-11.json',
      content: JSON.stringify({ version: 1, time_blocks: [{ id: 'tb-1' }], active_block: null }),
      timeBlockCount: 1,
      activeBlock: null,
    });
    settingsPageServiceMocks.timeblockBackup.exportTimeBlocksAsSqliteSnapshot.mockResolvedValue({
      fileName: 'exomind-timeblocks.sqlite',
      bytes: new Uint8Array([5, 4, 3]),
      timeBlockCount: 2,
      activeBlockPresent: true,
    });
    settingsPageServiceMocks.timeblockBackup.importTimeBlocksFromJson.mockResolvedValue({
      imported: 1,
      skipped: 0,
      total: 1,
      activeBlockUpdated: false,
    });
    settingsPageServiceMocks.timeblockBackup.importTimeBlocksFromSqliteSnapshot.mockResolvedValue({
      imported: 2,
      skipped: 0,
      total: 2,
      activeBlockUpdated: true,
    });
    settingsPageServiceMocks.timeblockBackup.getBackendStatus.mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    tauriMocks.isTauri.mockResolvedValue(false);
    tauriMocks.invoke.mockResolvedValue(null);
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    anchorClickSpy.mockRestore();
  });

  function selectTimeBlockDomain(): void {
    fireEvent.click(screen.getByRole('button', { name: /时间块 本轮尚未迁移|时间块/ }));
  }

  it('exports timeblock JSON from unified data dialog', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTimeBlockDomain();
    fireEvent.click(screen.getByRole('button', { name: /JSON 可读、可审查/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(settingsPageServiceMocks.timeblockBackup.exportTimeBlocksAsJson).toHaveBeenCalledTimes(1);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('时间块导出成功（JSON），共 1 条记录。')).toBeInTheDocument();
  });

  it('exports timeblock SQLite via tauri native save command', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue('D:/Downloads/exomind-timeblocks.sqlite');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    selectTimeBlockDomain();
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith('save_binary_file', {
        content: [5, 4, 3],
        defaultName: 'exomind-timeblocks.sqlite',
        filters: ['sqlite', 'db'],
      });
    });
    expect(screen.getByText(/时间块导出成功（SQLite），共 2 条记录。保存路径：/)).toBeInTheDocument();
  });

  it('imports timeblock SQLite through shared input', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    selectTimeBlockDomain();
    fireEvent.click(screen.getByRole('button', { name: /SQLite 保留本地域快照/ }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件并导入' }));

    const input = screen.getByTestId('new-settings-data-import-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'timeblocks.sqlite', {
      type: 'application/octet-stream',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(settingsPageServiceMocks.timeblockBackup.importTimeBlocksFromSqliteSnapshot).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'merge',
      );
    });
    expect(screen.getByText(/时间块导入成功：新增 2 条/)).toBeInTheDocument();
  });
});
