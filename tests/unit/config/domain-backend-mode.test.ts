import { beforeEach, describe, expect, it } from 'vitest';
import {
  getEventlogBackendMode,
  getTaskBackendMode,
  getTimeblockBackendMode,
  setAllBackendModes,
  setEventlogBackendMode,
  setTaskBackendMode,
  setTimeblockBackendMode,
} from '@/config/domain-backend-mode';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('domain backend mode（领域后端模式）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults each domain to rt-sqlite（默认都走 rt-sqlite）', () => {
    expect(getEventlogBackendMode()).toBe('rt-sqlite');
    expect(getTaskBackendMode()).toBe('rt-sqlite');
    expect(getTimeblockBackendMode()).toBe('rt-sqlite');
  });

  it('reads runtime-backed modes before localStorage（优先读取 Runtime 中的后端模式）', () => {
    window.localStorage.setItem('exomind:eventlogBackendMode', 'legacy');
    window.localStorage.setItem('exomind:taskBackendMode', 'legacy');
    window.localStorage.setItem('exomind:timeblockBackendMode', 'legacy');
    __primeRuntimeConfigForTests({
      'exomind:eventlogBackendMode': 'rt-sqlite',
      'exomind:taskBackendMode': 'rt-sqlite',
      'exomind:timeblockBackendMode': 'rt-sqlite',
    });

    expect(getEventlogBackendMode()).toBe('rt-sqlite');
    expect(getTaskBackendMode()).toBe('rt-sqlite');
    expect(getTimeblockBackendMode()).toBe('rt-sqlite');
  });

  it('persists each explicit setter（各领域 setter 会持久化）', () => {
    expect(setEventlogBackendMode('legacy')).toBe('legacy');
    expect(setTaskBackendMode('legacy')).toBe('legacy');
    expect(setTimeblockBackendMode('legacy')).toBe('legacy');

    expect(window.localStorage.getItem('exomind:eventlogBackendMode')).toBe('legacy');
    expect(window.localStorage.getItem('exomind:taskBackendMode')).toBe('legacy');
    expect(window.localStorage.getItem('exomind:timeblockBackendMode')).toBe('legacy');
  });

  it('keeps task/timeblock pinned to rt-sqlite even after bulk legacy writes（批量 legacy 写入后 task/timeblock 仍固定为 rt-sqlite）', () => {
    setAllBackendModes('legacy');

    expect(getEventlogBackendMode()).toBe('legacy');
    expect(getTaskBackendMode()).toBe('rt-sqlite');
    expect(getTimeblockBackendMode()).toBe('rt-sqlite');
  });
});
