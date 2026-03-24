/**
 * TaskPouchAdapter 单元测试
 *
 * 通过 ITaskPort 接口测试 PouchDB 适配器。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskPouchAdapter } from '@/lib/adapters/task-pouch-adapter';
import { TaskStorage } from '@/lib/storage/task-storage';
import type { ITaskPort } from '@/lib/environment/interfaces/task.port';

describe('TaskPouchAdapter (ITaskPort)', () => {
  let adapter: ITaskPort;
  let storage: TaskStorage;
  const testUserId = () => `pouch-adapter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let userId: string;

  beforeEach(() => {
    userId = testUserId();
    adapter = new TaskPouchAdapter(userId);
    storage = new TaskStorage(userId);
  });

  afterEach(async () => {
    await storage.clearAll();
    await storage.close();
  });

  it('createTask returns a TaskNode with generated id', async () => {
    const task = await adapter.createTask({ title: '新任务' });
    expect(task.id).toBeDefined();
    expect(task.title).toBe('新任务');
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('medium');
    expect(task.dependsOn).toEqual([]);
    expect(task.tags).toEqual([]);
  });

  it('listTasks excludes cancelled by default', async () => {
    const t1 = await adapter.createTask({ title: 't1' });
    await adapter.createTask({ title: 't2' });

    // Transition t1 to in_progress then cancelled
    await adapter.transitionTask(t1.id, 'in_progress');
    await adapter.transitionTask(t1.id, 'cancelled');

    const tasks = await adapter.listTasks();
    expect(tasks.every((t) => t.status !== 'cancelled')).toBe(true);
    expect(tasks).toHaveLength(1);
  });

  it('listTasks with includeCancelled=true returns all', async () => {
    const t1 = await adapter.createTask({ title: 't1' });
    await adapter.createTask({ title: 't2' });
    await adapter.transitionTask(t1.id, 'in_progress');
    await adapter.transitionTask(t1.id, 'cancelled');

    const tasks = await adapter.listTasks(true);
    expect(tasks).toHaveLength(2);
  });

  it('getTaskById returns null for missing', async () => {
    expect(await adapter.getTaskById('nope')).toBeNull();
  });

  it('getTaskById returns task', async () => {
    const created = await adapter.createTask({ title: '查询测试' });
    const fetched = await adapter.getTaskById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('查询测试');
  });

  it('updateTask modifies fields', async () => {
    const task = await adapter.createTask({ title: 'before' });
    const updated = await adapter.updateTask(task.id, { title: 'after', description: '描述' });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('after');
    expect(updated!.description).toBe('描述');
  });

  it('updateTask returns null for missing', async () => {
    expect(await adapter.updateTask('nope', { title: 'x' })).toBeNull();
  });

  it('transitionTask changes status via state machine', async () => {
    const task = await adapter.createTask({ title: '状态转换' });
    expect(task.status).toBe('pending');

    const inProgress = await adapter.transitionTask(task.id, 'in_progress');
    expect(inProgress!.status).toBe('in_progress');

    const completed = await adapter.transitionTask(task.id, 'completed');
    expect(completed!.status).toBe('completed');
    expect(completed!.completedAt).toBeDefined();
  });

  it('transitionTask throws on invalid transition', async () => {
    const task = await adapter.createTask({ title: '非法转换' });
    // pending -> completed is invalid
    await expect(adapter.transitionTask(task.id, 'completed')).rejects.toThrow();
  });

  it('cancelTask sets status to cancelled with completedAt', async () => {
    const task = await adapter.createTask({ title: '取消测试' });
    await adapter.transitionTask(task.id, 'in_progress');
    const cancelled = await adapter.cancelTask(task.id);
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.completedAt).toBeDefined();
  });

  it('cancelTask returns null for missing', async () => {
    expect(await adapter.cancelTask('nope')).toBeNull();
  });

  it('getAvailableTransitions returns valid next states', async () => {
    const task = await adapter.createTask({ title: '转换查询' });
    const transitions = await adapter.getAvailableTransitions(task.id);
    expect(transitions).toEqual(['in_progress']);

    await adapter.transitionTask(task.id, 'in_progress');
    const next = await adapter.getAvailableTransitions(task.id);
    expect(next).toContain('suspended');
    expect(next).toContain('completed');
    expect(next).toContain('cancelled');
  });

  it('getAvailableTransitions returns empty for missing', async () => {
    expect(await adapter.getAvailableTransitions('nope')).toEqual([]);
  });
});
