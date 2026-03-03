import { describe, expect, test } from 'vitest';
import { createMcpEnvironment } from '../src/utils/mcp-environment';
import { RemoteEventLogPort } from '../src/ports/remote-eventlog-port';
import { WebEventLogStorageAdapter } from '../../../src/lib/adapters/web-eventlog-storage';

describe('createMcpEnvironment', () => {
  test('auto mode uses remote eventlog when userId is set (default localhost:6984)', () => {
    const snapshot = snapshotEnv();
    try {
      process.env.EXOMIND_MCP_USER_ID = 'alice';
      delete process.env.EXOMIND_MCP_EVENTLOG_MODE;
      delete process.env.EXOMIND_MCP_SYNC_SERVER_URL;
      delete process.env.EXOMIND_POUCHDB_PORT;

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
});

function snapshotEnv(): Record<string, string | undefined> {
  return {
    EXOMIND_MCP_USER_ID: process.env.EXOMIND_MCP_USER_ID,
    EXOMIND_MCP_EVENTLOG_MODE: process.env.EXOMIND_MCP_EVENTLOG_MODE,
    EXOMIND_MCP_SYNC_SERVER_URL: process.env.EXOMIND_MCP_SYNC_SERVER_URL,
    EXOMIND_POUCHDB_PORT: process.env.EXOMIND_POUCHDB_PORT,
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
