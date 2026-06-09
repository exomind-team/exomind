import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORTS,
  parsePort,
  resolveBffCorsPolicy,
  resolveAsrServerUrl,
  resolveDevPorts,
} from '@/config/port-env';

describe('port env resolver', () => {
  it('parsePort should fallback for invalid values', () => {
    expect(parsePort(undefined, DEFAULT_PORTS.web)).toBe(DEFAULT_PORTS.web);
    expect(parsePort('', DEFAULT_PORTS.web)).toBe(DEFAULT_PORTS.web);
    expect(parsePort('abc', DEFAULT_PORTS.web)).toBe(DEFAULT_PORTS.web);
    expect(parsePort('0', DEFAULT_PORTS.web)).toBe(DEFAULT_PORTS.web);
    expect(parsePort('65536', DEFAULT_PORTS.web)).toBe(DEFAULT_PORTS.web);
  });

  it('parsePort should accept valid port values', () => {
    expect(parsePort('1', DEFAULT_PORTS.web)).toBe(1);
    expect(parsePort('1919', DEFAULT_PORTS.web)).toBe(1919);
    expect(parsePort('65535', DEFAULT_PORTS.web)).toBe(65535);
  });

  it('resolveDevPorts should read EXOMIND_* env values', () => {
    const ports = resolveDevPorts({
      EXOMIND_WEB_PORT: '1919',
      EXOMIND_HMR_PORT: '1929',
    });

    expect(ports.web).toBe(1919);
    expect(ports.hmr).toBe(1929);
  });

  it('resolveDevPorts should auto-derive HMR port from web port', () => {
    const ports = resolveDevPorts({
      EXOMIND_WEB_PORT: '1810',
    });

    expect(ports.web).toBe(1810);
    expect(ports.hmr).toBe(1811);
  });

  it('resolveAsrServerUrl should prefer VITE_ASR_SERVER_URL', () => {
    const serverUrl = resolveAsrServerUrl({
      VITE_ASR_SERVER_URL: 'http://localhost:19049',
      EXOMIND_ASR_PORT: '1931',
    });

    expect(serverUrl).toBe('http://localhost:19049');
  });

  it('resolveAsrServerUrl should fallback to EXOMIND_ASR_PORT', () => {
    const serverUrl = resolveAsrServerUrl({
      EXOMIND_ASR_PORT: '1931',
    });

    expect(serverUrl).toBe('http://localhost:1931');
  });

  it('resolveAsrServerUrl should fallback to runtime hostname when provided', () => {
    const serverUrl = resolveAsrServerUrl(
      {
        EXOMIND_ASR_PORT: '1931',
      },
      {
        hostname: '192.168.1.20',
      }
    );

    expect(serverUrl).toBe('http://192.168.1.20:1931');
  });

  it('resolveAsrServerUrl should normalize tauri.localhost to loopback（ASR 本地域名应映射到回环地址）', () => {
    const serverUrl = resolveAsrServerUrl(
      {
        EXOMIND_ASR_PORT: '1931',
      },
      {
        hostname: 'tauri.localhost',
      }
    );

    expect(serverUrl).toBe('http://127.0.0.1:1931');
  });

  it('resolveBffCorsPolicy should allow all origins in development by default', () => {
    const policy = resolveBffCorsPolicy({
      NODE_ENV: 'development',
      EXOMIND_WEB_PORT: '1420',
    });

    expect(policy.allowAllOrigins).toBe(true);
    expect(policy.allowOrigins).toEqual([]);
    expect(policy.allowCredentials).toBe(false);
  });

  it('resolveBffCorsPolicy should restrict to web origin in production by default', () => {
    const policy = resolveBffCorsPolicy(
      {
        NODE_ENV: 'production',
        EXOMIND_WEB_PORT: '1420',
      },
      { hostname: '192.168.1.50' }
    );

    expect(policy.allowAllOrigins).toBe(false);
    expect(policy.allowOrigins).toEqual(['http://192.168.1.50:1420']);
    expect(policy.allowCredentials).toBe(false);
  });

  it('resolveBffCorsPolicy should parse explicit origins from env', () => {
    const policy = resolveBffCorsPolicy({
      NODE_ENV: 'production',
      EXOMIND_BFF_ALLOWED_ORIGINS: 'http://localhost:1420, http://192.168.1.50:1620/',
    });

    expect(policy.allowAllOrigins).toBe(false);
    expect(policy.allowOrigins).toEqual([
      'http://localhost:1420',
      'http://192.168.1.50:1620',
    ]);
    expect(policy.allowCredentials).toBe(false);
  });
});
