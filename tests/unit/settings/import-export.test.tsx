import { describe, expect, it } from 'vitest';
import { SETTINGS_REGISTRY } from '@/ui/app/config/settings/settings-registry';

describe('settings registry import/export entries', () => {
  it('defines backup import/export controls in the registry', () => {
    const labels = SETTINGS_REGISTRY.map((item) => item.label);

    expect(labels).toContain('导出备份');
    expect(labels).toContain('导入数据');
  });

  it('defines sync server control in the registry', () => {
    const syncServerItem = SETTINGS_REGISTRY.find((item) => item.id === 'sync-server-url');

    expect(syncServerItem).toBeDefined();
    expect(syncServerItem?.label).toBe('同步服务器');
    expect(syncServerItem?.type).toBe('string');
  });
});
