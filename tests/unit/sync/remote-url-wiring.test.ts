import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('eventlog sync remote url wiring', () => {
  const chatPagePath = path.resolve('src/components/Chat/ChatPage.tsx');
  const adapterPath = path.resolve('src/adapters/pouch-sync.ts');
  const chatPage = readFileSync(chatPagePath, 'utf-8');
  const adapter = readFileSync(adapterPath, 'utf-8');

  it('ChatPage should read/write events through EventLogService', () => {
    expect(chatPage).toContain("from '@/lib/services/eventlog.service'");
    expect(chatPage).toContain('getEventLogService()');
    expect(chatPage).toContain('loadEventsDetailed()');
  });

  it('PouchSyncAdapter should use shared remote DB URL builder', () => {
    expect(adapter).toContain("from '@/lib/sync/remote-db-url'");
    expect(adapter).toContain('buildRemoteDbUrl(');
  });

  it('ChatPage should not wire UI directly to legacy sync URL builders', () => {
    expect(chatPage).not.toContain('/database/');
    expect(chatPage).not.toContain('buildRemoteDbUrl(');
    expect(chatPage).not.toContain('resolveSyncServerUrl(');
  });

  it('PouchSyncAdapter should not use legacy /database path prefix', () => {
    expect(adapter).not.toContain('/database/');
  });
});

