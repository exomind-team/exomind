import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('now workbench overlay capability（当下工作台悬浮窗权限）', () => {
  it('allows native start dragging for the overlay window（放行原生拖动权限）', () => {
    const filePath = resolve(process.cwd(), 'src-tauri/capabilities/now-workbench-overlay.json');
    const capability = JSON.parse(readFileSync(filePath, 'utf8')) as {
      permissions: string[];
    };

    expect(capability.permissions).toContain('core:window:allow-start-dragging');
    expect(capability.permissions).toContain('core:window:allow-hide');
    expect(capability.permissions).toContain('core:window:allow-show');
    expect(capability.permissions).toContain('core:window:allow-set-focus');
    expect(capability.permissions).toContain('core:window:allow-set-size');
    expect(capability.permissions).toContain('core:window:allow-get-all-windows');
  });
});
