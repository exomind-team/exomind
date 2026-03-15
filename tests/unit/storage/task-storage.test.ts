/**
 * TaskStorage 单元测试
 *
 * 测试 PouchDB 存储层的 CRUD、索引查询、数据迁移。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskStorage } from '@/lib/storage/task-storage';
import type { TaskNode } from '@/lib/types/task';

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  const now = Date.now();
  return {
    title: overrides.id,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('TaskStorage CRUD', () => {
  let storage: TaskStorage;

  beforeEach(() => {
    const testUserId = `task-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    storage = new TaskStorage(testUserId);
  });

  afterEach(async () => {
    await storage.clearAll();
    await storage.close();
  });

  it('addTask + getTask round-trip', async () => {
    const task = makeTask({ id: 'task-1', title: '测试任务' });
    await storage.addTask(task);

    const retrieved = await storage.getTask('task-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('task-1');
    expect(retrieved!.title).toBe('测试任务');
    expect(retrieved!.status).toBe('pending');
  });

  it('getTask returns undefined for missing id', async () => {
    const result = await storage.getTask('nonexistent');
    expect(result).toBeUndefined();
  });

  it('getTasks returns all tasks ordered by createdAt desc', async () => {
    const t1 = makeTask({ id: 't1', createdAt: 1000, updatedAt: 1000 });
    const t2 = makeTask({ id: 't2', createdAt: 2000, updatedAt: 2000 });
    const t3 = makeTask({ id: 't3', createdAt: 3000, updatedAt: 3000 });

    await storage.addTask(t1);
    await storage.addTask(t2);
    await storage.addTask(t3);

    const tasks = await storage.getTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe('t3');
    expect(tasks[2].id).toBe('t1');
  });

  it('updateTask modifies fields and updates updatedAt', async () => {
    const task = makeTask({ id: 'u1', title: 'original' });
    await storage.addTask(task);

    const updated = await storage.updateTask('u1', { title: 'modified' });
    expect(updated).toBeDefined();
    expect(updated!.title).toBe('modified');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);

    const fetched = await storage.getTask('u1');
    expect(fetched!.title).toBe('modified');
  });

  it('updateTask returns undefined for missing id', async () => {
    const result = await storage.updateTask('nope', { title: 'x' });
    expect(result).toBeUndefined();
  });

  it('deleteDoc removes the task', async () => {
    const task = makeTask({ id: 'd1' });
    await storage.addTask(task);
    await storage.deleteDoc('d1');

    const result = await storage.getTask('d1');
    expect(result).toBeUndefined();
  });

  it('clearAll removes all tasks', async () => {
    await storage.addTask(makeTask({ id: 'c1' }));
    await storage.addTask(makeTask({ id: 'c2' }));
    expect(await storage.count()).toBe(2);

    await storage.clearAll();
    expect(await storage.count()).toBe(0);
  });

  it('count returns number of tasks', async () => {
    expect(await storage.count()).toBe(0);
    await storage.addTask(makeTask({ id: 'n1' }));
    await storage.addTask(makeTask({ id: 'n2' }));
    expect(await storage.count()).toBe(2);
  });
});

describe('TaskStorage index queries', () => {
  let storage: TaskStorage;

  beforeEach(() => {
    const testUserId = `task-idx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    storage = new TaskStorage(testUserId);
  });

  afterEach(async () => {
    await storage.clearAll();
    await storage.close();
  });

  it('getTasksByStatus filters correctly', async () => {
    await storage.addTask(makeTask({ id: 's1', status: 'in_progress' }));
    await storage.addTask(makeTask({ id: 's2', status: 'pending' }));
    await storage.addTask(makeTask({ id: 's3', status: 'in_progress' }));

    const inProgress = await storage.getTasksByStatus('in_progress');
    expect(inProgress).toHaveLength(2);
    expect(inProgress.every((t) => t.status === 'in_progress')).toBe(true);
  });

  it('getTasksByParent filters by parentId', async () => {
    await storage.addTask(makeTask({ id: 'p1', parentId: 'root' }));
    await storage.addTask(makeTask({ id: 'p2', parentId: 'root' }));
    await storage.addTask(makeTask({ id: 'p3', parentId: 'other' }));

    const rootChildren = await storage.getTasksByParent('root');
    expect(rootChildren).toHaveLength(2);
    expect(rootChildren.every((t) => t.parentId === 'root')).toBe(true);
  });
});
