import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMigrationSkipped,
  clearMigrationFlags,
  isMigrationCompleted,
  isMigrationPending,
  isMigrationSkipped,
  markMigrationCompleted,
  markMigrationPending,
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

  it('returns false for pending when no flags set（未设置时 pending 返回 false）', () => {
    expect(isMigrationPending()).toBe(false);
  });

  it('markMigrationCompleted sets completed flag（标记完成后 completed 为 true）', () => {
    markMigrationCompleted();
    expect(isMigrationCompleted()).toBe(true);
  });

  it('markMigrationSkipped sets skipped flag（标记跳过后 skipped 为 true）', () => {
    markMigrationSkipped();
    expect(isMigrationSkipped()).toBe(true);
  });

  it('markMigrationPending sets pending flag（标记迁移中后 pending 为 true）', () => {
    markMigrationPending();
    expect(isMigrationPending()).toBe(true);
  });

  it('markMigrationCompleted clears skipped flag（标记完成同时清除跳过标志）', () => {
    markMigrationSkipped();
    markMigrationPending();
    expect(isMigrationSkipped()).toBe(true);
    expect(isMigrationPending()).toBe(true);

    markMigrationCompleted();
    expect(isMigrationCompleted()).toBe(true);
    expect(isMigrationSkipped()).toBe(false);
    expect(isMigrationPending()).toBe(false);
  });

  it('clearMigrationSkipped only removes skipped flag（仅清除跳过标志）', () => {
    markMigrationSkipped();
    markMigrationPending();

    clearMigrationSkipped();

    expect(isMigrationSkipped()).toBe(false);
    expect(isMigrationPending()).toBe(true);
  });

  it('clearMigrationFlags removes all flags（clearMigrationFlags 清除所有标志）', () => {
    markMigrationCompleted();
    markMigrationSkipped();
    markMigrationPending();

    clearMigrationFlags();

    expect(isMigrationCompleted()).toBe(false);
    expect(isMigrationSkipped()).toBe(false);
    expect(isMigrationPending()).toBe(false);
  });
});
