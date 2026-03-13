import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildManagedTauriCommand,
  resolveManagedTauriInstancePaths,
} from '../../../Scripts/dev/tauri-dev-manager-lib';

describe('tauri-dev-manager-lib', () => {
  it('resolves managed instance paths under project tmp directory（实例元数据与日志应落到项目内 .tmp 目录）', () => {
    const projectRoot = path.resolve('D:/project/exomind');
    const paths = resolveManagedTauriInstancePaths(projectRoot, 'UI 4K / left panel');

    expect(paths.name).toBe('ui-4k-left-panel');
    expect(paths.registryDir).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-instances'));
    expect(paths.metaPath).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-instances', 'ui-4k-left-panel.json'));
    expect(paths.logPath).toBe(path.join(projectRoot, '.tmp', 'tauri-dev-instances', 'ui-4k-left-panel.log'));
  });

  it('builds a scoped start command with explicit ports and log redirection（启动命令应显式绑定端口并写日志）', () => {
    const command = buildManagedTauriCommand({
      projectRoot: 'D:\\project\\exomind',
      name: 'ui-4k-left-panel',
      webPort: 1520,
      hmrPort: 1521,
      logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\ui-4k-left-panel.log',
    });

    expect(command).toContain('cd /d "D:\\project\\exomind"');
    expect(command).toContain('set "EXOMIND_WEB_PORT=1520"');
    expect(command).toContain('set "EXOMIND_HMR_PORT=1521"');
    expect(command).toContain('set "EXOMIND_TAURI_INSTANCE_NAME=ui-4k-left-panel"');
    expect(command).toContain('bun run tauri dev > "D:\\project\\exomind\\.tmp\\tauri-dev-instances\\ui-4k-left-panel.log" 2>&1');
    expect(command).not.toContain('taskkill');
  });

  it('opt-in watch mode only affects the managed instance env（watch 开关只作用于当前实例环境）', () => {
    const command = buildManagedTauriCommand({
      projectRoot: 'D:\\project\\exomind',
      name: 'watch-on',
      webPort: 1620,
      hmrPort: 1621,
      logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\watch-on.log',
      enableWatch: true,
    });

    expect(command).toContain('set "EXOMIND_TAURI_ENABLE_WATCH=1"');
  });
});
