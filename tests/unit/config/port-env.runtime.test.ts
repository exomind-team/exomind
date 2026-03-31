import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSyncServerUrlOverride,
  setSyncServerUrlOverride,
} from '@/config/port-env';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('port env runtime override（同步地址运行时覆盖）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to null when no override exists（未设置覆盖地址时返回 null）', () => {
    expect(getSyncServerUrlOverride()).toBeNull();
  });

  it('reads runtime-backed override before localStorage（优先读取 Runtime 中的同步地址覆盖）', () => {
    window.localStorage.setItem('exomind:syncServerUrl', 'http://127.0.0.1:6984');
    __primeRuntimeConfigForTests({
      'exomind:syncServerUrl': 'http://10.0.0.5:6984',
    });

    expect(getSyncServerUrlOverride()).toBe('http://10.0.0.5:6984');
  });

  it('persists normalized override and clears on null（保存归一化地址并支持清空）', () => {
    setSyncServerUrlOverride('http://10.0.0.8:6984/');
    expect(getSyncServerUrlOverride()).toBe('http://10.0.0.8:6984');
    expect(window.localStorage.getItem('exomind:syncServerUrl')).toBe('http://10.0.0.8:6984');

    setSyncServerUrlOverride(null);
    expect(getSyncServerUrlOverride()).toBeNull();
    expect(window.localStorage.getItem('exomind:syncServerUrl')).toBeNull();
  });
});
