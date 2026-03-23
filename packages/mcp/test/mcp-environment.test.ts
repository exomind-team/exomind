import { describe, expect, test } from 'bun:test';
import { createMcpEnvironment } from '../src/utils/mcp-environment';
import { RemoteEventLogPort } from '../src/ports/remote-eventlog-port';
import { RtEventLogPort } from '../src/ports/rt-eventlog-port';
import { WebEventLogStorageAdapter } from '../../../src/lib/adapters/web-eventlog-storage';

describe('createMcpEnvironment', () => {
  test('auto mode uses remote eventlog when userId is set (default localhost:6984)', () => {
    const snapshot = snapshotEnv();
    try {
      process.env.EXOMIND_MCP_USER_ID = 'alice';
      delete process.env.EXOMIND_MCP_EVENTLOG_MODE;
      delete process.env.EXOMIND_MCP_SYNC_SERVER_URL;
      delete process.env.EXOMIND_POUCHDB_PORT;
      delete process.env.EXOMIND_MCP_RT_URL;

      const env = createMcpEnvironment();
      expect(env.eventlog).toBeInstanceOf(RemoteEventLogPort);
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('local mode forces local adapter even when userId is set', () => {
    const snapshot = snapshotEnv();
    try {
      process.env.EXOMIND_MCP_USER_ID = 'alice';
      process.env.EXOMIND_MCP_EVENTLOG_MODE = 'local';

      const env = createMcpEnvironment();
      expect(env.eventlog).toBeInstanceOf(WebEventLogStorageAdapter);
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('remote mode without userId throws', () => {
    const snapshot = snapshotEnv();
    try {
      delete process.env.EXOMIND_MCP_USER_ID;
      process.env.EXOMIND_MCP_EVENTLOG_MODE = 'remote';

      expect(() => createMcpEnvironment()).toThrow(/EXOMIND_MCP_USER_ID is required/i);
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('rt mode uses RtEventLogPort', () => {
    const snapshot = snapshotEnv();
    try {
      process.env.EXOMIND_MCP_EVENTLOG_MODE = 'rt';
      process.env.EXOMIND_MCP_RT_URL = 'http://localhost:1949';
      process.env.EXOMIND_MCP_USER_ID = 'test-user';

      const env = createMcpEnvironment();
      expect(env.eventlog).toBeInstanceOf(RtEventLogPort);
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('auto mode with EXOMIND_MCP_RT_URL set uses RtEventLogPort', () => {
    const snapshot = snapshotEnv();
    try {
      delete process.env.EXOMIND_MCP_EVENTLOG_MODE;
      process.env.EXOMIND_MCP_RT_URL = 'http://localhost:1949';
      process.env.EXOMIND_MCP_USER_ID = 'test-user';

      const env = createMcpEnvironment();
      expect(env.eventlog).toBeInstanceOf(RtEventLogPort);
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('rt mode without userId defaults to anonymous', () => {
    const snapshot = snapshotEnv();
    try {
      process.env.EXOMIND_MCP_EVENTLOG_MODE = 'rt';
      delete process.env.EXOMIND_MCP_USER_ID;

      const env = createMcpEnvironment();
      expect(env.eventlog).toBeInstanceOf(RtEventLogPort);
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('rt mode passes EXOMIND_MCP_RT_TOKEN to RtEventLogPort', () => {
    const snapshot = snapshotEnv();
    try {
      process.env.EXOMIND_MCP_EVENTLOG_MODE = 'rt';
      process.env.EXOMIND_MCP_RT_URL = 'http://localhost:1949';
      process.env.EXOMIND_MCP_RT_TOKEN = 'my-secret-token';
      process.env.EXOMIND_MCP_USER_ID = 'test-user';

      const env = createMcpEnvironment();
      expect(env.eventlog).toBeInstanceOf(RtEventLogPort);
      // Verify token is stored (access private field via cast for test)
      const port = env.eventlog as unknown as { token?: string };
      expect(port.token).toBe('my-secret-token');
    } finally {
      restoreEnv(snapshot);
    }
  });
});

function snapshotEnv(): Record<string, string | undefined> {
  return {
    EXOMIND_MCP_USER_ID: process.env.EXOMIND_MCP_USER_ID,
    EXOMIND_MCP_EVENTLOG_MODE: process.env.EXOMIND_MCP_EVENTLOG_MODE,
    EXOMIND_MCP_SYNC_SERVER_URL: process.env.EXOMIND_MCP_SYNC_SERVER_URL,
    EXOMIND_POUCHDB_PORT: process.env.EXOMIND_POUCHDB_PORT,
    EXOMIND_MCP_RT_URL: process.env.EXOMIND_MCP_RT_URL,
    EXOMIND_MCP_RT_TOKEN: process.env.EXOMIND_MCP_RT_TOKEN,
  };
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

