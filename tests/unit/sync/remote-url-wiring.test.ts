import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('eventlog sync remote url wiring', () => {
  const chatPagePath = path.resolve('src/components/Chat/ChatPage.tsx');
  const adapterPath = path.resolve('src/adapters/pouch-sync.ts');
  const chatPage = readFileSync(chatPagePath, 'utf-8');
  const adapter = readFileSync(adapterPath, 'utf-8');

  it('ChatPage should use shared remote DB URL builder', () => {
    expect(chatPage).toContain("from '@/lib/sync/remote-db-url'");
    expect(chatPage).toContain('buildRemoteDbUrl(');
  });

  it('PouchSyncAdapter should use shared remote DB URL builder', () => {
    expect(adapter).toContain("from '@/lib/sync/remote-db-url'");
    expect(adapter).toContain('buildRemoteDbUrl(');
  });

  it('ChatPage should not use legacy /database path prefix', () => {
    expect(chatPage).not.toContain('/database/');
  });

  it('PouchSyncAdapter should not use legacy /database path prefix', () => {
    expect(adapter).not.toContain('/database/');
  });
});

