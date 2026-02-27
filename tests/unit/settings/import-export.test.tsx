import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('NewSettingsPage import/export', () => {
  const newSettingsPath = path.resolve('src/ui/new/pages/NewSettingsPage.tsx');
  const source = fs.readFileSync(newSettingsPath, 'utf-8');

  it('renders backup import/export controls', () => {
    expect(source).toContain('导出备份');
    expect(source).toContain('导入数据');
  });

  it('renders sync server controls', () => {
    expect(source).toContain('同步服务器');
    expect(source).toContain('handleSaveSyncServerUrl');
  });
});
