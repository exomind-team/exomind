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
  });
});
