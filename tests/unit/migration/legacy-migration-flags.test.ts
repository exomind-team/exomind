import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMigrationFlags,
  isMigrationCompleted,
  isMigrationSkipped,
  markMigrationCompleted,
  markMigrationSkipped,
} from '@/lib/migration/legacy-migration-flags';

describe('legacy migration flags（历史数据迁移状态标志）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
      },
    });
  });

  it('returns false for completed when no flags set（未设置时 completed 返回 false）', () => {
    expect(isMigrationCompleted()).toBe(false);
  });

  it('returns false for skipped when no flags set（未设置时 skipped 返回 false）', () => {
    expect(isMigrationSkipped()).toBe(false);
  });

  it('markMigrationCompleted sets completed flag（标记完成后 completed 为 true）', () => {
    markMigrationCompleted();
    expect(isMigrationCompleted()).toBe(true);
  });

  it('markMigrationSkipped sets skipped flag（标记跳过后 skipped 为 true）', () => {
    markMigrationSkipped();
    expect(isMigrationSkipped()).toBe(true);
  });

  it('markMigrationCompleted clears skipped flag（标记完成同时清除跳过标志）', () => {
    markMigrationSkipped();
    expect(isMigrationSkipped()).toBe(true);

    markMigrationCompleted();
    expect(isMigrationCompleted()).toBe(true);
    expect(isMigrationSkipped()).toBe(false);
  });

  it('clearMigrationFlags removes all flags（clearMigrationFlags 清除所有标志）', () => {
    markMigrationCompleted();
    markMigrationSkipped();

    clearMigrationFlags();

    expect(isMigrationCompleted()).toBe(false);
    expect(isMigrationSkipped()).toBe(false);
  });
});
