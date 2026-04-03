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
      expect(result.stdout).toContain('tauri-dev\\web-1520');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it('injects isolated instance dirs for tauri dev（tauri dev 应注入实例级数据目录）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-instance-paths-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'echo EXOMIND_DEV_INSTANCE_NAME=%EXOMIND_DEV_INSTANCE_NAME%',
          'echo EXOMIND_DEV_APP_DATA_DIR=%EXOMIND_DEV_APP_DATA_DIR%',
          'echo EXOMIND_DEV_RUNTIME_DATA_DIR=%EXOMIND_DEV_RUNTIME_DATA_DIR%',
          'echo EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR=%EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR%',
          'echo EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT=%EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT%',
          'echo EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR=%EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR%',
          'echo EXOMIND_MCP_BRIDGE_BASE_PORT=%EXOMIND_MCP_BRIDGE_BASE_PORT%',
          'if /I "%3"=="--config" type "%4"',
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
            APPDATA: 'C:\\Users\\starlin\\AppData\\Roaming',
            LOCALAPPDATA: 'C:\\Users\\starlin\\AppData\\Local',
            EXOMIND_TAURI_INSTANCE_NAME: 'desktop',
            EXOMIND_WEB_PORT: '1520',
            EXOMIND_HMR_PORT: '1521',
            EXOMIND_RT_PORT: '1949',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('EXOMIND_DEV_INSTANCE_NAME=desktop');
      expect(result.stdout).toContain('.tmp\\tauri-dev-state\\desktop\\app-data');
      expect(result.stdout).toContain('.tmp\\tauri-dev-state\\desktop\\webview\\main');
      expect(result.stdout).toContain('EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR=C:\\Users\\starlin\\AppData\\Roaming\\com.exomind.app\\runtime');
      expect(result.stdout).toContain('EXOMIND_MCP_BRIDGE_BASE_PORT=9323');
      expect(result.stdout).toContain('"devUrl":"http://localhost:1520"');
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

  it('keeps watch-enabled dev args separated when appending config（开启 watch 后追加 config 参数时不应拼接成单个子命令）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-watch-config-'));
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
            EXOMIND_TAURI_ENABLE_WATCH: '1',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ARGS=dev --config');
      expect(result.stdout).not.toContain('ARGS=dev--config');
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

  it('injects the only connected Android device name into tauri android dev（单个在线 Android 设备应自动注入可识别设备名）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-android-device-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const fakeBunCmd = join(fakeBinDir, 'bun.cmd');
    const fakeAdbCmd = join(fakeBinDir, 'adb.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'if /I "%1"=="icon" (',
          '  mkdir "%4\\android\\mipmap-mdpi" >nul 2>&1',
          '  type nul > "%4\\android\\mipmap-mdpi\\ic_launcher.png"',
          '  exit /b 0',
          ')',
          'echo ARGS=%*',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      writeFileSync(
        fakeBunCmd,
        [
          '@echo off',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      writeFileSync(
        fakeAdbCmd,
        [
          '@echo off',
          'if /I "%1"=="-s" if /I "%3"=="emu" if /I "%4"=="avd" if /I "%5"=="name" (',
          '  echo test3_Tablet',
          '  exit /b 0',
          ')',
          'if /I "%1"=="devices" (',
          '  echo List of devices attached',
          '  echo emulator-5556	device',
          '  exit /b 0',
          ')',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      const result = spawnSync(
        POWERSHELL_PATH,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath, 'android', 'dev', '--target', 'x86_64'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBinDir};${process.env.PATH ?? ''}`,
            EXOMIND_WEB_PORT: '1520',
            EXOMIND_HMR_PORT: '1521',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ARGS=android dev test3_Tablet --target x86_64');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it('overrides android devUrl when EXOMIND_WEB_PORT is set（android dev 应跟随实例端口覆盖 devUrl）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-android-devurl-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const fakeAdbCmd = join(fakeBinDir, 'adb.cmd');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'echo ARGS=%*',
          'set CONFIG=',
          ':loop',
          'if "%~1"=="" goto after',
          'if /I "%~1"=="--config" (',
          '  set CONFIG=%~2',
          ')',
          'shift',
          'goto loop',
          ':after',
          'if not "%CONFIG%"=="" (',
          '  echo CONFIG_FILE=%CONFIG%',
          '  type "%CONFIG%"',
          ')',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      writeFileSync(
        fakeAdbCmd,
        [
          '@echo off',
          'if /I "%1"=="-s" if /I "%3"=="emu" if /I "%4"=="avd" if /I "%5"=="name" (',
          '  echo test3_Tablet',
          '  exit /b 0',
          ')',
          'if /I "%1"=="devices" (',
          '  echo List of devices attached',
          '  echo emulator-5556	device',
          '  exit /b 0',
          ')',
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
            EXOMIND_WEB_PORT: '1520',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ARGS=android dev test3_Tablet --config');
      expect(result.stdout).toContain('"devUrl":"http://localhost:1520"');
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

  it('creates bun.bat shim when only bun.exe exists in PATH（仅有 bun.exe 时自动补 bun.bat 兼容层）', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tauri-wrapper-bun-shim-'));
    const fakeBinDir = join(tempDir, 'bin');
    const fakeTauriCmd = join(fakeBinDir, 'tauri.cmd');
    const fakeBunExe = join(fakeBinDir, 'bun.exe');
    const wrapperPath = join(process.cwd(), 'Scripts', 'dev', 'tauri-wrapper.ps1');

    try {
      spawnSync('cmd.exe', ['/c', 'mkdir', fakeBinDir], { stdio: 'ignore' });

      writeFileSync(
        fakeTauriCmd,
        [
          '@echo off',
          'if not exist "%~dp0bun.bat" exit /b 87',
          'exit /b 0',
          '',
        ].join('\r\n'),
        'utf8',
      );

      writeFileSync(fakeBunExe, 'not-a-real-exe', 'utf8');

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
      expect(result.stdout).toContain('Created bun.bat shim');
      const shimPath = join(fakeBinDir, 'bun.bat');
      expect(shimPath).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);
});
