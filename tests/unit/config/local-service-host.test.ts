import { afterEach, describe, expect, it } from 'vitest';
import { resolveLocalServiceHost } from '@/config/local-service-host';

describe('local service host resolver（本地服务 host 解析）', () => {
  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('maps tauri.localhost to loopback（Tauri 资源域名映射为 loopback）', () => {
    expect(resolveLocalServiceHost('tauri.localhost')).toBe('127.0.0.1');
  });

  it('keeps loopback as 127.0.0.1 inside tauri windows（Tauri 窗口内保持 127.0.0.1 回环地址）', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });

    expect(resolveLocalServiceHost('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveLocalServiceHost('tauri.localhost')).toBe('127.0.0.1');
  });

  it('keeps regular hostnames unchanged（普通主机名保持原样）', () => {
    expect(resolveLocalServiceHost('192.168.1.20')).toBe('192.168.1.20');
    expect(resolveLocalServiceHost('localhost')).toBe('127.0.0.1');
  });
});
