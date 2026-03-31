import { beforeEach, describe, expect, it } from 'vitest';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('task create success action config（任务创建后行为配置）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to refocus when missing（未设置时默认回焦）', async () => {
    const module = await import('@/config/task-create-success-action');
    expect(module.getTaskCreateSuccessAction()).toBe('refocus');
  });

  it('normalizes invalid values back to refocus（非法值回退到默认）', async () => {
    localStorage.setItem('exomind:taskCreateSuccessAction', 'invalid');
    const module = await import('@/config/task-create-success-action');
    expect(module.getTaskCreateSuccessAction()).toBe('refocus');
  });

  it('reads runtime-backed action before localStorage（优先读取 Runtime 中的成功动作）', async () => {
    localStorage.setItem('exomind:taskCreateSuccessAction', 'refocus');
    __primeRuntimeConfigForTests({ 'exomind:taskCreateSuccessAction': 'open-detail' });

    const module = await import('@/config/task-create-success-action');
    expect(module.getTaskCreateSuccessAction()).toBe('open-detail');
  });

  it('persists and emits open-detail（支持持久化打开详情）', async () => {
    const module = await import('@/config/task-create-success-action');
    const listener = vi.fn();
    const unsubscribe = module.subscribeTaskCreateSuccessActionChanges(listener);

    expect(module.setTaskCreateSuccessAction('open-detail')).toBe('open-detail');
    expect(module.getTaskCreateSuccessAction()).toBe('open-detail');
    expect(localStorage.getItem('exomind:taskCreateSuccessAction')).toBe('open-detail');
    expect(listener).toHaveBeenCalledWith('open-detail');

    unsubscribe();
  });
});
