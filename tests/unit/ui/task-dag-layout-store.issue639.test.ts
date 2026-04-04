import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY,
  getTaskDagManualLayoutSnapshot,
  pruneTaskDagManualLayoutSnapshot,
  setTaskDagManualLayoutSnapshot,
  updateTaskDagManualLayoutPosition,
  type TaskDagManualLayoutSnapshot,
} from '@/ui/app/pages/task-dag-layout-store';

function installStorageStub(storage: Record<string, string>): void {
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
      clear: () => {
        for (const key of Object.keys(storage)) {
          delete storage[key];
        }
      },
      key: (index: number) => Object.keys(storage)[index] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    },
  });
}

describe('task-dag-layout-store issue #639（任务 DAG 手动布局快照纯函数）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T08:00:00.000Z'));
    installStorageStub({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a sanitized manual snapshot from storage（读取时清洗非法快照）', () => {
    window.localStorage.setItem(TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY, JSON.stringify({
      manualPositions: {
        'task-a': { x: 120, y: 240 },
        'task-b': { x: Number.NaN, y: 10 },
        'task-c': { x: 'bad', y: 30 },
        'task-d': null,
      },
      updatedAt: 42,
    }));

    expect(getTaskDagManualLayoutSnapshot()).toEqual({
      manualPositions: {
        'task-a': { x: 120, y: 240 },
      },
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('writes snapshots and removes storage when cleared（支持写入与清空快照）', () => {
    const snapshot: TaskDagManualLayoutSnapshot = {
      manualPositions: {
        'task-a': { x: 10, y: 20 },
      },
      updatedAt: '2026-04-03T07:30:00.000Z',
    };

    expect(setTaskDagManualLayoutSnapshot(snapshot)).toEqual(snapshot);
    expect(JSON.parse(window.localStorage.getItem(TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY) ?? 'null')).toEqual(snapshot);

    expect(setTaskDagManualLayoutSnapshot(null)).toBeNull();
    expect(window.localStorage.getItem(TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it('upserts one node position without wiping existing entries（单节点更新不会清空整份快照）', () => {
    const snapshot: TaskDagManualLayoutSnapshot = {
      manualPositions: {
        'task-a': { x: 10, y: 20 },
        'task-b': { x: 30, y: 40 },
      },
      updatedAt: '2026-04-03T07:30:00.000Z',
    };

    expect(updateTaskDagManualLayoutPosition(snapshot, 'task-c', { x: 50, y: 60 })).toEqual({
      manualPositions: {
        'task-a': { x: 10, y: 20 },
        'task-b': { x: 30, y: 40 },
        'task-c': { x: 50, y: 60 },
      },
      updatedAt: '2026-04-03T08:00:00.000Z',
    });
  });

  it('prunes stale ids and keeps still-valid positions（清理失效节点并保留仍有效的位置）', () => {
    const snapshot: TaskDagManualLayoutSnapshot = {
      manualPositions: {
        'task-a': { x: 10, y: 20 },
        'task-b': { x: 30, y: 40 },
        'task-stale': { x: 90, y: 120 },
      },
      updatedAt: '2026-04-03T07:30:00.000Z',
    };

    expect(pruneTaskDagManualLayoutSnapshot(snapshot, ['task-b', 'task-c'])).toEqual({
      manualPositions: {
        'task-b': { x: 30, y: 40 },
      },
      updatedAt: '2026-04-03T07:30:00.000Z',
    });
  });

  it('returns null after pruning when no valid node positions remain（全部失效后返回空）', () => {
    const snapshot: TaskDagManualLayoutSnapshot = {
      manualPositions: {
        'task-stale': { x: 90, y: 120 },
      },
      updatedAt: '2026-04-03T07:30:00.000Z',
    };

    expect(pruneTaskDagManualLayoutSnapshot(snapshot, ['task-a', 'task-b'])).toBeNull();
  });
});
