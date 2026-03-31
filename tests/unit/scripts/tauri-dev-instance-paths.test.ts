import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveTauriDevInstancePaths,
  resolveTauriDevInstanceName,
} from '../../../scripts/dev/tauri-dev-instance-paths';

describe('tauri-dev-instance-paths', () => {
  it('derives a stable sanitized instance name（实例名应稳定且可净化）', () => {
    expect(resolveTauriDevInstanceName({
      EXOMIND_TAURI_INSTANCE_NAME: 'Issue 773 / Node First',
    })).toBe('issue-773-node-first');
  });

  it('resolves isolated paths per instance（不同实例应映射到不同隔离目录）', () => {
    const projectRoot = path.resolve('D:/project/exomind');
    const desktop = resolveTauriDevInstancePaths(projectRoot, {
      EXOMIND_TAURI_INSTANCE_NAME: 'desktop',
      EXOMIND_WEB_PORT: '1420',
      APPDATA: 'C:\\Users\\starlin\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\starlin\\AppData\\Local',
    });
    const issue773 = resolveTauriDevInstancePaths(projectRoot, {
      EXOMIND_TAURI_INSTANCE_NAME: 'issue-773-node-first',
      EXOMIND_WEB_PORT: '1430',
      APPDATA: 'C:\\Users\\starlin\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\starlin\\AppData\\Local',
    });

    expect(desktop.instanceName).toBe('desktop');
    expect(issue773.instanceName).toBe('issue-773-node-first');
    expect(desktop.stateRootDir).not.toBe(issue773.stateRootDir);
    expect(desktop.webviewMainDataDir).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-state', 'desktop', 'webview', 'main'));
    expect(desktop.webviewOverlayDataRoot).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-state', 'desktop', 'webview', 'overlay'));
    expect(desktop.appDataDir).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-state', 'desktop', 'app-data'));
    expect(desktop.runtimeDataDir).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-state', 'desktop', 'app-data', 'runtime'));
    expect(desktop.legacySharedAppDataDir).toBe(path.join('C:\\Users\\starlin\\AppData\\Roaming', 'com.exomind.app'));
    expect(desktop.legacySharedRuntimeDir).toBe(path.join('C:\\Users\\starlin\\AppData\\Roaming', 'com.exomind.app', 'runtime'));
    expect(desktop.mcpBridgeBasePort).toBe(9223);
    expect(issue773.mcpBridgeBasePort).toBe(9233);
  });
});
