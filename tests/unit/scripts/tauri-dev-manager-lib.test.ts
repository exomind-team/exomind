import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  appendManagedTauriLogSessionStart,
  buildLowMemoryTauriEnv,
  buildManagedTauriCommand,
  collectManagedDesktopAppPids,
  collectManagedTauriCleanupPids,
  evaluateManagedTauriInstanceHealth,
  resolveManagedTauriInstancePaths,
} from '../../../scripts/dev/tauri-dev-manager-lib';

describe('tauri-dev-manager-lib', () => {
  it('builds a bounded Windows linker environment for low-memory Tauri runs（低内存模式应限制编译与链接并发）', () => {
    const env = buildLowMemoryTauriEnv({
      baseEnv: { PATH: 'C:\\Tools', RUSTFLAGS: '-C target-cpu=x86-64' },
      targetDir: 'G:\\exomind-cargo-target\\tauri-dev\\low-memory-shared',
      rustLldPath: 'C:\\Rust\\bin\\rust-lld.exe',
    });

    expect(env.CARGO_BUILD_JOBS).toBe('1');
    expect(env.CARGO_PROFILE_DEV_DEBUG).toBe('0');
    expect(env.CARGO_PROFILE_DEV_INCREMENTAL).toBe('false');
    expect(env.CARGO_PROFILE_DEV_CODEGEN_UNITS).toBe('16');
    expect(env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER).toBe('C:\\Rust\\bin\\rust-lld.exe');
    expect(env.EXOMIND_TAURI_TARGET_DIR).toBe('G:\\exomind-cargo-target\\tauri-dev\\low-memory-shared');
    expect(env.RUSTFLAGS).toBe(
      '-C target-cpu=x86-64 -C linker-flavor=lld-link -C link-arg=/threads:1 -C link-arg=/DEBUG:NONE',
    );
    expect(env.PATH).toBe('C:\\Tools');
  });

  it('does not add a blank prefix when low-memory mode starts without RUSTFLAGS（无既有 RUSTFLAGS 时不应生成空白前缀）', () => {
    const env = buildLowMemoryTauriEnv({
      baseEnv: {},
      targetDir: 'G:\\target',
      rustLldPath: 'C:\\Rust\\rust-lld.exe',
    });

    expect(env.RUSTFLAGS).toBe(
      '-C linker-flavor=lld-link -C link-arg=/threads:1 -C link-arg=/DEBUG:NONE',
    );
  });

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

  it('does not kill an unrelated listener when the root process already died（根进程已死时不得按端口误杀其他实例）', () => {
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
        rootExecutablePath: 'C:\\Bun\\bun.exe',
        rootCreationDate: '2026-03-18T10:02:03.000Z',
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

    expect(cleanupPids).toEqual([]);
  });

  it('only cleans path-confirmed app processes and their descendants after root exit（根进程退出后只清理路径已确认的 app 链）', () => {
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
        rootExecutablePath: 'C:\\Bun\\bun.exe',
        rootCreationDate: '2026-03-18T10:02:03.000Z',
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

    expect(cleanupPids).toEqual([7777, 8888]);
  });

  it('requires the recorded root identity before stopping the root process tree（终止根进程树前必须匹配记录的根身份）', () => {
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
        rootExecutablePath: 'C:\\Bun\\bun.exe',
        rootCreationDate: '2026-03-18T10:02:03.000Z',
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
          {
            ProcessId: 1234,
            ParentProcessId: 10,
            Name: 'bun.exe',
            ExecutablePath: 'C:\\Bun\\bun.exe',
            CreationDate: '2026-03-18T10:02:03.000Z',
          },
          { ProcessId: 333436, ParentProcessId: 88, Name: 'node.exe' },
          { ProcessId: 444001, ParentProcessId: 333436, Name: 'node.exe' },
          { ProcessId: 7777, ParentProcessId: 99, Name: 'exomind.exe' },
          { ProcessId: 8888, ParentProcessId: 7777, Name: 'conhost.exe' },
        ],
      },
    );

    expect(cleanupPids).toEqual([1234, 7777, 8888]);
  });

  it('refuses a reused root pid when its creation time differs（根 PID 被复用时拒绝终止）', () => {
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
        rootExecutablePath: 'C:\\Bun\\bun.exe',
        rootCreationDate: '2026-03-18T10:02:03.000Z',
      },
      {
        rootPidAlive: true,
        webPortListening: false,
        hmrPortListening: false,
        appProcessAlive: false,
        webPortPids: [],
        hmrPortPids: [],
        appPids: [],
        processes: [
          {
            ProcessId: 1234,
            ParentProcessId: 10,
            Name: 'bun.exe',
            ExecutablePath: 'C:\\Bun\\bun.exe',
            CreationDate: '2026-03-18T12:00:00.000Z',
          },
        ],
      },
    );

    expect(cleanupPids).toEqual([]);
  });

  it('leaves legacy records without root identity untouched（缺少根身份的旧记录不由 stop 自动终止）', () => {
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
        webPortListening: false,
        hmrPortListening: false,
        appProcessAlive: false,
        webPortPids: [],
        hmrPortPids: [],
        appPids: [],
        processes: [
          {
            ProcessId: 1234,
            ParentProcessId: 10,
            Name: 'bun.exe',
            ExecutablePath: 'C:\\Bun\\bun.exe',
            CreationDate: '2026-03-18T10:02:03.000Z',
          },
        ],
      },
    );

    expect(cleanupPids).toEqual([]);
  });

  it('allows a listener only when its command line matches the managed target dir（只有命令行走实例目标目录的监听进程才允许回收）', () => {
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
        targetDir: 'G:\\exomind-cargo-target\\tauri-dev\\desktop',
        rootExecutablePath: 'C:\\Bun\\bun.exe',
        rootCreationDate: '2026-03-18T10:02:03.000Z',
      },
      {
        rootPidAlive: false,
        webPortListening: true,
        hmrPortListening: false,
        appProcessAlive: false,
        webPortPids: [333436],
        hmrPortPids: [],
        appPids: [],
        processes: [
          {
            ProcessId: 333436,
            ParentProcessId: 88,
            Name: 'node.exe',
            CommandLine: 'node G:\\exomind-cargo-target\\tauri-dev\\desktop\\vite.cjs',
          },
          { ProcessId: 444001, ParentProcessId: 333436, Name: 'node.exe' },
        ],
      },
    );

    expect(cleanupPids).toEqual([333436, 444001]);
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

  it('does not recognize shared low-memory executables by path alone（低内存共享 target 不得仅靠可执行路径认领进程）', () => {
    const appPids = collectManagedDesktopAppPids({
      rootPid: 1234,
      expectedBaseName: 'exomind',
      expectedExecutablePath: 'G:\\exomind-cargo-target\\tauri-dev\\low-memory-shared\\debug\\exomind.exe',
      allowPathOnlyMatch: false,
      processes: [
        {
          ProcessId: 7777,
          ParentProcessId: 88,
          Name: 'exomind.exe',
          CommandLine: '"G:\\exomind-cargo-target\\tauri-dev\\low-memory-shared\\debug\\exomind.exe"',
        },
      ],
    });

    expect(appPids).toEqual([]);
  });
});
