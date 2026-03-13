import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('dev instance title capability（开发态窗口标题权限）', () => {
  it('allows the main window to update its native title（主窗口允许更新原生标题）', () => {
    const filePath = resolve(process.cwd(), 'src-tauri/capabilities/default.json');
    const capability = JSON.parse(readFileSync(filePath, 'utf8')) as {
      permissions: string[];
    };

    expect(capability.permissions).toContain('core:window:allow-set-title');
  });
});
