import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportTasksJson,
  exportTasksSqlite,
  importTasksFromFile,
} from '@/services/impl/settings-data-service';

const mocks = vi.hoisted(() => ({
  exportEventsAsJson: vi.fn(),
  importEventsFromJson: vi.fn(),
  exportTasksAsJson: vi.fn(),
  exportTasksAsSqliteSnapshot: vi.fn(),
  importTasksFromJson: vi.fn(),
  importTasksFromSqliteSnapshot: vi.fn(),
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: mocks.exportEventsAsJson,
    importEventsFromJson: mocks.importEventsFromJson,
  }),
  getTaskBackupService: () => ({
    exportTasksAsJson: mocks.exportTasksAsJson,
    exportTasksAsSqliteSnapshot: mocks.exportTasksAsSqliteSnapshot,
    importTasksFromJson: mocks.importTasksFromJson,
    importTasksFromSqliteSnapshot: mocks.importTasksFromSqliteSnapshot,
  }),
}));

describe('settings-data-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
    mocks.exportTasksAsJson.mockResolvedValue({
      fileName: 'exomind-tasks-2026-03-11.json',
      content: JSON.stringify({ version: 1, tasks: [] }),
      taskCount: 0,
    });
    mocks.exportTasksAsSqliteSnapshot.mockResolvedValue({
      fileName: 'exomind-tasks.sqlite',
      bytes: new Uint8Array([1, 2, 3]),
      taskCount: 3,
    });
    mocks.importTasksFromJson.mockResolvedValue({ imported: 1, skipped: 0, total: 1 });
    mocks.importTasksFromSqliteSnapshot.mockResolvedValue({ imported: 2, skipped: 0, total: 2 });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:task-export'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('exports task JSON on Web and returns success message', async () => {
    const message = await exportTasksJson();

    expect(mocks.exportTasksAsJson).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(message).toBe('任务导出成功（JSON），共 0 条任务。');
  });

  it('exports task SQLite on Tauri and returns save path message', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue('D:/Downloads/exomind-tasks.sqlite');

    const message = await exportTasksSqlite();

    expect(mocks.invoke).toHaveBeenCalledWith('save_binary_file', {
      content: [1, 2, 3],
      defaultName: 'exomind-tasks.sqlite',
      filters: ['sqlite', 'db'],
    });
    expect(message).toBe('任务导出成功（SQLite），共 3 条任务。保存路径：D:/Downloads/exomind-tasks.sqlite');
  });

  it('imports JSON task backup file and returns success message', async () => {
    const file = new File([JSON.stringify({ version: 1, tasks: [] })], 'tasks.json', {
      type: 'application/json',
    });

    const message = await importTasksFromFile(file, 'merge');

    expect(mocks.importTasksFromJson).toHaveBeenCalledWith(expect.stringContaining('"tasks"'), 'merge');
    expect(message).toBe('任务导入成功：新增 1 条，跳过 0 条，当前共 1 条。来源：tasks.json');
  });

  it('imports SQLite task backup file and returns success message', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'tasks.sqlite', {
      type: 'application/octet-stream',
    });

    const message = await importTasksFromFile(file, 'merge');

    expect(mocks.importTasksFromSqliteSnapshot).toHaveBeenCalledWith(expect.any(Uint8Array), 'merge');
    expect(message).toBe('任务导入成功：新增 2 条，跳过 0 条，当前共 2 条。来源：tasks.sqlite');
  });
});
