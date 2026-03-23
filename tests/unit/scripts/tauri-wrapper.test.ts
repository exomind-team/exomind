import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POWERSHELL_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

const describeWindowsOnly = process.platform === 'win32' ? describe : describe.skip;

describeWindowsOnly('tauri-wrapper', () => {
  it('resolves cargo via rustup when cargo is missing in PATH（PATH 缺少 cargo 时可通过 rustup 补齐）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-test-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeCargoDir = join(tempDir, 'cargo');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const fakeRustupCmd = join(fakeBinDir, 'rustup.cmd');
    const fakeCargoCmd = join(fakeCargoDir, 'cargo.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeCargoDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'cargo --version >nul 2>&1',
          'if errorlevel 1 exit /b 99',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      writeFileSync(
        fakeCargoCmd,
        [
          '@echo off',
          'echo cargo 0.0.0-test',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const cargoPathForCmd = fakeCargoCmd.replaceAll('/', '\\');
      writeFileSync(
        fakeRustupCmd,
        [
          '@echo off',
          'if /I "%1"=="which" if /I "%2"=="cargo" (',
          `  echo ${cargoPathForCmd}`,
          '  exit /b 0',
          ')',
          'exit /b 1',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const result = spawnSync(
        POWERSHELL_PATH,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath, 'info'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: fakeBinDir,
          },
        },
      );

      expect(result.status).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it('injects isolated CARGO_TARGET_DIR for tauri dev（tauri dev 应注入独立构建目录）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-target-dir-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'echo CARGO_TARGET_DIR=%CARGO_TARGET_DIR%',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const result = spawnSync(
        POWERSHELL_PATH,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath, 'dev'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBinDir};${process.env.PATH ?? ''}`,
            EXOMIND_WEB_PORT: '1520',
            EXOMIND_HMR_PORT: '1521',
            EXOMIND_RT_PORT: '1949',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('target\\tauri-dev\\web-1520');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it('disables tauri watcher by default for dev（默认关闭 tauri watcher 避免无关改动触发黑屏重启）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-no-watch-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'echo ARGS=%*',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const result = spawnSync(
        POWERSHELL_PATH,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath, 'dev'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBinDir};${process.env.PATH ?? ''}`,
            EXOMIND_WEB_PORT: '1520',
            EXOMIND_HMR_PORT: '1521',
            EXOMIND_RT_PORT: '1949',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ARGS=dev --no-watch');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it('does not treat tauri stderr status lines as wrapper failure（tauri stderr 状态日志不应让包装脚本失败）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-stderr-status-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'echo      Running BeforeDevCommand (`bun run dev`) 1>&2',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const result = spawnSync(
        POWERSHELL_PATH,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath, 'info'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBinDir};${process.env.PATH ?? ''}`,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Running BeforeDevCommand');
      expect(result.stderr).not.toContain('NativeCommandError');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it('falls back to adb install for android dev install failures（android dev 安装失败时走 adb 兜底安装）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-android-fallback-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const fakeAdbCmd = join(fakeBinDir, 'adb.cmd');
    const adbLogPath = join(tempDir, 'adb.log');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');
    const apkOutputDir = join(
      process.cwd(),
      'src-tauri',
      'gen',
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'x86_64',
      'debug',
    );
    const apkPath = join(apkOutputDir, 'app-x86_64-debug.apk');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });
      spawnSync('cmd.exe', ['/c', 'mkdir', apkOutputDir], { stdio: 'ignore' });
      writeFileSync(apkPath, 'fake-apk', 'utf8');

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'if /I "%1"=="icon" (',
          '  mkdir "%4\\android\\mipmap-mdpi" 2>nul',
          '  type nul > "%4\\android\\mipmap-mdpi\\ic_launcher.png"',
          '  exit /b 0',
          ')',
          'echo adb.exe: failed to install test.apk:',
          'echo failed to run Android app: failed to install APK',
          'exit /b 255',
          '',
        ].join('\r\n'),
        'utf8',
      );

      writeFileSync(
        fakeAdbCmd,
        [
          '@echo off',
          'if /I "%1"=="devices" (',
          '  echo List of devices attached',
          '  echo emulator-5554	device',
          '  exit /b 0',
          ')',
          `echo %*>> "${adbLogPath.replaceAll('/', '\\')}"`,
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const result = spawnSync(
        POWERSHELL_PATH,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath, 'android', 'dev'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBinDir};${process.env.PATH ?? ''}`,
          },
        },
      );

      expect(result.status).toBe(0);

      const adbLog = spawnSync('cmd.exe', ['/c', 'type', adbLogPath], {
        encoding: 'utf8',
      }).stdout;
      expect(adbLog).toContain('-s emulator-5554 install -r -d -g -t');
      expect(adbLog).toMatch(/shell monkey -p com\.exomind\.app -c android\.intent\.category\.LAUNCHER/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);
});
