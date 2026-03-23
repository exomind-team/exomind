import { afterEach, describe, expect, it, vi } from 'vitest';

const originalHost = process.env.EXOMIND_POUCHDB_HOST;

async function loadServerConfig() {
  vi.resetModules();
  const module = await import('../../server/config.js');
  return module.default;
}

afterEach(() => {
  if (typeof originalHost === 'undefined') {
    delete process.env.EXOMIND_POUCHDB_HOST;
  } else {
    process.env.EXOMIND_POUCHDB_HOST = originalHost;
  }
});

describe('pouchdb server host mode', () => {
  it('defaults to loopback host in local mode', async () => {
    delete process.env.EXOMIND_POUCHDB_HOST;
    const config = await loadServerConfig();

    expect(config.host).toBe('127.0.0.1');
  });

  it('uses explicit host override for LAN testing mode', async () => {
    process.env.EXOMIND_POUCHDB_HOST = '0.0.0.0';
    const config = await loadServerConfig();

    expect(config.host).toBe('0.0.0.0');
  });

  it('supports custom bind host override', async () => {
    process.env.EXOMIND_POUCHDB_HOST = '192.168.1.77';
    const config = await loadServerConfig();

    expect(config.host).toBe('192.168.1.77');
  });
});

