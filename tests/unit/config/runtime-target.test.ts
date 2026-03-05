import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  getRuntimeExternalAddress,
  getRuntimeTargetMode,
  getSelectedRuntimeTarget,
  setRuntimeExternalAddress,
  setRuntimeTargetMode,
  subscribeRuntimeTargetChanges,
} from '@/config/runtime-target';

describe('runtime target config（Runtime 目标配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to embedded runtime port（默认内嵌 runtime 端口）', () => {
    expect(getRuntimeTargetMode()).toBe('embedded');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'embedded',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
  });

  it('switches to external runtime with default 1949（切到外部默认 1949）', () => {
    setRuntimeTargetMode('external');

    expect(getRuntimeTargetMode()).toBe('external');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      host: '127.0.0.1',
      port: 1949,
    });
  });

  it('persists external address and emits changes（保存外部地址并发变更事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimeTargetChanges(listener);

    setRuntimeExternalAddress('10.8.0.5:2999');
    setRuntimeTargetMode('external');

    expect(getRuntimeExternalAddress()).toBe('10.8.0.5:2999');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      host: '10.8.0.5',
      port: 2999,
    });
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('rejects invalid external address（拒绝非法 host:port）', () => {
    expect(() => setRuntimeExternalAddress('http://bad:1949/path')).toThrow();
    expect(() => setRuntimeExternalAddress('no-port')).toThrow();
    expect(() => setRuntimeExternalAddress('127.0.0.1:70000')).toThrow();
  });
});

