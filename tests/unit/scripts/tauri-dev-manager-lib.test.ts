import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  appendManagedTauriLogSessionStart,
  buildManagedTauriCommand,
  collectManagedDesktopAppPids,
  collectManagedTauriCleanupPids,
  evaluateManagedTauriInstanceHealth,
  resolveManagedTauriInstancePaths,
} from '../../../scripts/dev/tauri-dev-manager-lib';

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

  it('appends a new manager session marker instead of truncating old logs（启动新会话应追加旧日志而不是覆盖）', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'tauri-dev-manager-log-'));
    const logPath = path.join(tempDir, 'desktop.log');

    try {
      await writeFile(logPath, 'previous line\n', 'utf8');
      await appendManagedTauriLogSessionStart(logPath, {
        name: 'desktop',
        target: 'desktop',
        webPort: 1420,
        hmrPort: 1421,
        startedAt: '2026-03-18T10:02:03.000Z',
      });

      const content = await readFile(logPath, 'utf8');
      expect(content).toContain('previous line');
      expect(content).toContain('manager session start');
      expect(content).toContain('name=desktop');
      expect(content).toContain('web=1420');
      expect(content.indexOf('previous line')).toBeLessThan(content.indexOf('manager session start'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps fresh desktop startup in starting state while the app process is still warming up（桌面实例冷启动编译阶段不应误报 stale）', () => {
    const health = evaluateManagedTauriInstanceHealth(
      {
        name: 'desktop',
        projectRoot: 'D:\\project\\exomind',
        rootPid: 1234,
        webPort: 1420,
        hmrPort: 1421,
        logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.log',
        metaPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.json',
        startedAt: new Date(Date.now() - 15_000).toISOString(),
        enableWatch: false,
        target: 'desktop',
      },
      {
        rootPidAlive: true,
        webPortListening: true,
        hmrPortListening: true,
        appProcessAlive: false,
      },
    );

    expect(health.status).toBe('starting');
    expect(health.detail).toContain('desktop app process warming up');
    expect(health.detail).toContain('web=1420');
    expect(health.detail).toContain('hmr=1421');
  });

  it('marks desktop instances stale when the Tauri app process never appears after startup grace period（桌面窗口进程长时间未出现时才应判定为 stale）', () => {
    const health = evaluateManagedTauriInstanceHealth(
      {
        name: 'desktop',
        projectRoot: 'D:\\project\\exomind',
        rootPid: 1234,
        webPort: 1420,
        hmrPort: 1421,
        logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.log',
        metaPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.json',
        startedAt: new Date(Date.now() - 180_000).toISOString(),
        enableWatch: false,
        target: 'desktop',
      },
      {
        rootPidAlive: true,
        webPortListening: true,
        hmrPortListening: true,
        appProcessAlive: false,
      },
    );

    expect(health.status).toBe('stale');
    expect(health.detail).toContain('desktop app process missing');
    expect(health.detail).toContain('web=1420');
    expect(health.detail).toContain('hmr=1421');
  });

  it('keeps desktop instances running only when root pid app process and ports are all healthy（桌面实例需进程和端口都健康才算 running）', () => {
    const health = evaluateManagedTauriInstanceHealth(
      {
        name: 'desktop',
        projectRoot: 'D:\\project\\exomind',
        rootPid: 1234,
        webPort: 1420,
        hmrPort: 1421,
        logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.log',
        metaPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.json',
        startedAt: '2026-03-18T10:02:03.000Z',
        enableWatch: false,
        target: 'desktop',
      },
      {
        rootPidAlive: true,
        webPortListening: true,
        hmrPortListening: true,
        appProcessAlive: true,
      },
    );

    expect(health.status).toBe('running');
    expect(health.detail).toBe('ok');
  });

  it('collects leftover listener pids when the root process already died（根进程已死时 stop 应回收残留监听进程）', () => {
    const cleanupPids = collectManagedTauriCleanupPids(
      {
        name: 'desktop',
        projectRoot: 'D:\\project\\exomind',
        rootPid: 1234,
        webPort: 1420,
        hmrPort: 1421,
        logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.log',
        metaPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.json',
        startedAt: '2026-03-18T10:02:03.000Z',
        enableWatch: false,
        target: 'desktop',
      },
      {
        rootPidAlive: false,
        webPortListening: true,
        hmrPortListening: true,
        appProcessAlive: false,
        webPortPids: [333436],
        hmrPortPids: [333436],
        appPids: [],
      },
    );

    expect(cleanupPids).toEqual([333436]);
  });

  it('collects descendants of leftover listener processes when the root pid already died（根进程已死时应连同残留监听进程的子孙进程一起回收）', () => {
    const cleanupPids = collectManagedTauriCleanupPids(
      {
        name: 'desktop',
        projectRoot: 'D:\\project\\exomind',
        rootPid: 1234,
        webPort: 1420,
        hmrPort: 1421,
        logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.log',
        metaPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.json',
        startedAt: '2026-03-18T10:02:03.000Z',
        enableWatch: false,
        target: 'desktop',
      },
      {
        rootPidAlive: false,
        webPortListening: true,
        hmrPortListening: true,
        appProcessAlive: false,
        webPortPids: [333436],
        hmrPortPids: [333436],
        appPids: [7777],
        processes: [
          { ProcessId: 333436, ParentProcessId: 88, Name: 'node.exe' },
          { ProcessId: 444001, ParentProcessId: 333436, Name: 'node.exe' },
          { ProcessId: 444002, ParentProcessId: 444001, Name: 'bun.exe' },
          { ProcessId: 7777, ParentProcessId: 99, Name: 'exomind.exe' },
          { ProcessId: 8888, ParentProcessId: 7777, Name: 'conhost.exe' },
        ],
      },
    );

    expect(cleanupPids).toEqual([333436, 7777, 444001, 444002, 8888]);
  });

  it('includes detached listener and app descendants even when the root pid is still alive（根进程仍存活时也应回收已识别监听器与桌面进程的脱链后代）', () => {
    const cleanupPids = collectManagedTauriCleanupPids(
      {
        name: 'desktop',
        projectRoot: 'D:\\project\\exomind',
        rootPid: 1234,
        webPort: 1420,
        hmrPort: 1421,
        logPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.log',
        metaPath: 'D:\\project\\exomind\\.tmp\\tauri-dev-instances\\desktop.json',
        startedAt: '2026-03-18T10:02:03.000Z',
        enableWatch: false,
        target: 'desktop',
      },
      {
        rootPidAlive: true,
        webPortListening: true,
        hmrPortListening: true,
        appProcessAlive: true,
        webPortPids: [333436],
        hmrPortPids: [333436],
        appPids: [7777],
        processes: [
          { ProcessId: 1234, ParentProcessId: 10, Name: 'bun.exe' },
          { ProcessId: 333436, ParentProcessId: 88, Name: 'node.exe' },
          { ProcessId: 444001, ParentProcessId: 333436, Name: 'node.exe' },
          { ProcessId: 7777, ParentProcessId: 99, Name: 'exomind.exe' },
          { ProcessId: 8888, ParentProcessId: 7777, Name: 'conhost.exe' },
        ],
      },
    );

    expect(cleanupPids).toEqual([1234, 333436, 7777, 444001, 8888]);
  });

  it('recognizes the desktop app by its resolved executable path even when it is no longer a bun descendant（桌面进程脱离 bun 子进程链后仍应被 manager 识别）', () => {
    const appPids = collectManagedDesktopAppPids({
      rootPid: 1234,
      expectedBaseName: 'exomind',
      expectedExecutablePath: 'G:\\exomind-cargo-target\\tauri-dev\\issue806-g\\debug\\exomind.exe',
      processes: [
        {
          ProcessId: 1234,
          ParentProcessId: 10,
          Name: 'bun.exe',
          CommandLine: 'bun run tauri dev',
        },
        {
          ProcessId: 7777,
          ParentProcessId: 88,
          Name: 'exomind.exe',
          CommandLine: '"G:\\exomind-cargo-target\\tauri-dev\\issue806-g\\debug\\exomind.exe"',
        },
      ],
    });

    expect(appPids).toEqual([7777]);
  });
});
