import { describe, expect, it, vi } from 'vitest';
import {
  executeMigration,
  type MigrationAdapters,
  type MigrationProgress,
} from '@/lib/migration/legacy-migration-executor';

function makeAdapters(overrides: Partial<MigrationAdapters> = {}): MigrationAdapters {
  return {
    readLegacyEvents: vi.fn().mockResolvedValue([]),
    readLegacyTasks: vi.fn().mockResolvedValue([]),
    readLegacyCompletedBlocks: vi.fn().mockResolvedValue([]),
    readLegacyActiveBlock: vi.fn().mockResolvedValue(null),
    importEventsToRt: vi.fn().mockResolvedValue(undefined),
    importTasksToRt: vi.fn().mockResolvedValue(undefined),
    writeCompletedBlocksToRt: vi.fn().mockResolvedValue(undefined),
    writeActiveBlockToRt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('executeMigration（迁移执行引擎）', () => {
  it('migrates all three domains successfully when legacy data exists（全三领域迁移成功）', async () => {
    const adapters = makeAdapters({
      readLegacyEvents: vi.fn().mockResolvedValue([{ id: 'e1' }]),
      readLegacyTasks: vi.fn().mockResolvedValue([{ id: 't1' }]),
      readLegacyCompletedBlocks: vi.fn().mockResolvedValue([{ id: 'b1' }]),
    });

    const result = await executeMigration(adapters);

    expect(result.success).toBe(true);
    expect(result.migratedDomains).toContain('eventlog');
    expect(result.migratedDomains).toContain('task');
    expect(result.migratedDomains).toContain('timeblock');
    expect(adapters.importEventsToRt).toHaveBeenCalledWith([{ id: 'e1' }]);
    expect(adapters.importTasksToRt).toHaveBeenCalledWith([{ id: 't1' }]);
    expect(adapters.writeCompletedBlocksToRt).toHaveBeenCalledWith([{ id: 'b1' }]);
  });

  it('reports failure when eventlog import fails（事件日志导入失败时报告失败）', async () => {
    const adapters = makeAdapters({
      readLegacyEvents: vi.fn().mockResolvedValue([{ id: 'e1' }]),
      importEventsToRt: vi.fn().mockRejectedValue(new Error('RT connection refused')),
    });

    const result = await executeMigration(adapters);

    expect(result.success).toBe(false);
    expect(result.error).toContain('RT connection refused');
  });

  it('skips domains with no legacy data（无旧数据时跳过对应领域）', async () => {
    const adapters = makeAdapters({
      readLegacyEvents: vi.fn().mockResolvedValue([]),
      readLegacyTasks: vi.fn().mockResolvedValue([]),
      readLegacyCompletedBlocks: vi.fn().mockResolvedValue([]),
      readLegacyActiveBlock: vi.fn().mockResolvedValue(null),
    });

    const result = await executeMigration(adapters);

    expect(result.success).toBe(true);
    expect(result.migratedDomains).toHaveLength(0);
    expect(adapters.importEventsToRt).not.toHaveBeenCalled();
    expect(adapters.importTasksToRt).not.toHaveBeenCalled();
    expect(adapters.writeCompletedBlocksToRt).not.toHaveBeenCalled();
    expect(adapters.writeActiveBlockToRt).not.toHaveBeenCalled();
  });

  it('migrates active block when present（存在活跃时间块时执行迁移）', async () => {
    const activeBlock = { id: 'active-1', startedAt: '2026-01-01T10:00:00Z' };
    const adapters = makeAdapters({
      readLegacyCompletedBlocks: vi.fn().mockResolvedValue([]),
      readLegacyActiveBlock: vi.fn().mockResolvedValue(activeBlock),
    });

    const result = await executeMigration(adapters);

    expect(result.success).toBe(true);
    expect(result.migratedDomains).toContain('timeblock');
    expect(adapters.writeActiveBlockToRt).toHaveBeenCalledWith(activeBlock);
  });

  it('calls onProgress for each domain step（每个领域步骤均触发进度回调）', async () => {
    const adapters = makeAdapters({
      readLegacyEvents: vi.fn().mockResolvedValue([{ id: 'e1' }]),
      readLegacyTasks: vi.fn().mockResolvedValue([{ id: 't1' }]),
      readLegacyCompletedBlocks: vi.fn().mockResolvedValue([{ id: 'b1' }]),
    });
    const progressCalls: MigrationProgress[] = [];
    const onProgress = vi.fn((p: MigrationProgress) => progressCalls.push(p));

    await executeMigration(adapters, onProgress);

    expect(onProgress).toHaveBeenCalled();
    const domains = progressCalls.map((p) => p.domain);
    expect(domains).toContain('eventlog');
    expect(domains).toContain('task');
    expect(domains).toContain('timeblock');
  });

  it('returns partial migratedDomains on mid-flight failure（中途失败时返回已完成领域）', async () => {
    const adapters = makeAdapters({
      readLegacyEvents: vi.fn().mockResolvedValue([{ id: 'e1' }]),
      readLegacyTasks: vi.fn().mockResolvedValue([{ id: 't1' }]),
      importTasksToRt: vi.fn().mockRejectedValue(new Error('task import error')),
    });

    const result = await executeMigration(adapters);

    expect(result.success).toBe(false);
    // eventlog should have completed before task failed
    expect(result.migratedDomains).toContain('eventlog');
    expect(result.migratedDomains).not.toContain('task');
  });
});
