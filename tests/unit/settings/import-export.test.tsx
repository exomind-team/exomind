import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SETTINGS_REGISTRY } from '@/ui/app/config/settings/settings-registry';

const source = readFileSync(path.resolve('src/services/impl/settings-data-service.ts'), 'utf-8');

describe('settings registry import/export entries', () => {
  it('defines unified data-transfer control in the registry', () => {
    const ids = SETTINGS_REGISTRY.map((item) => item.id);

    expect(ids).toContain('data-transfer');
    expect(ids).toContain('eventlog-backend-mode');
    expect(ids).not.toContain('task-backend-mode');
    expect(ids).not.toContain('timeblock-backend-mode');
  });

  it('defines sync server control in the registry', () => {
    const syncServerItem = SETTINGS_REGISTRY.find((item) => item.id === 'sync-server-url');

    expect(syncServerItem).toBeDefined();
    expect(syncServerItem?.label).toBe('RT 地址');
    expect(syncServerItem?.type).toBe('string');
  });

  it('uses generic backup filename prefix', () => {
    expect(source).toContain('exomind-data-');
    expect(source).not.toContain('exomind-eventlog-');
  });
});
