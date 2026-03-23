import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('fullscreen capability issue-556（主窗口全屏权限）', () => {
  it('allows the main window to toggle native fullscreen（主窗口允许切换原生全屏）', () => {
    const filePath = resolve(process.cwd(), 'src-tauri/capabilities/default.json');
    const capability = JSON.parse(readFileSync(filePath, 'utf8')) as {
      permissions: string[];
    };

    expect(capability.permissions).toContain('core:window:allow-set-fullscreen');
  });
});
