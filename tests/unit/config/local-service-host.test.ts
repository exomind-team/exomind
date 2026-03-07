import { describe, expect, it } from 'vitest';
import { resolveLocalServiceHost } from '@/config/local-service-host';

describe('local service host resolver（本地服务 host 解析）', () => {
  it('maps tauri.localhost to loopback（Tauri 资源域名映射为 loopback）', () => {
    expect(resolveLocalServiceHost('tauri.localhost')).toBe('127.0.0.1');
  });

  it('keeps regular hostnames unchanged（普通主机名保持原样）', () => {
    expect(resolveLocalServiceHost('192.168.1.20')).toBe('192.168.1.20');
    expect(resolveLocalServiceHost('localhost')).toBe('localhost');
  });
});
