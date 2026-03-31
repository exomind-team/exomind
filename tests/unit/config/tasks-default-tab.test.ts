import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeTasksDefaultTab,
  getTasksDefaultTab,
  setTasksDefaultTab,
} from '@/config/tasks-default-tab';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('tasks default tab（任务默认页签）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to null when key is missing（未设置时为空）', () => {
    expect(getTasksDefaultTab()).toBeNull();
  });

  it('reads runtime-backed tab before localStorage（优先读取 Runtime 中的默认页签）', () => {
    window.localStorage.setItem('exomind:tasks-default-tab', 'today');
    __primeRuntimeConfigForTests({ 'exomind:tasks-default-tab': 'dag' });

    expect(getTasksDefaultTab()).toBe('dag');
  });

  it('persists and consumes one-shot tab intent（支持保存并消费一次性页签意图）', () => {
    setTasksDefaultTab('week');
    expect(getTasksDefaultTab()).toBe('week');
    expect(window.localStorage.getItem('exomind:tasks-default-tab')).toBe('week');

    expect(consumeTasksDefaultTab()).toBe('week');
    expect(getTasksDefaultTab()).toBeNull();
    expect(window.localStorage.getItem('exomind:tasks-default-tab')).toBeNull();
  });
});
