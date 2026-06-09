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

  it('sets a deterministic main window title for debug and release builds（主窗口标题应区分开发态与发布态）', () => {
    const filePath = resolve(process.cwd(), 'src-tauri/src/lib.rs');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('#[cfg(not(any(target_os = "android", target_os = "ios")))]');
    expect(source).toContain('app.get_webview_window("main")');
    expect(source).toContain('main_window.set_title(&title)');
    expect(source).toContain('ExoMind (dev)');
    expect(source).toContain('ExoMind v{}');
    expect(source).toContain('env!("CARGO_PKG_VERSION")');
  });
});
