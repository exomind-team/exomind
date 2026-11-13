// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedTauriInstanceRecord, ManagedWindowsProcessInfo } from '../../../scripts/dev/tauri-dev-manager-lib';

const native = vi.hoisted(() => ({ spawnSync: vi.fn(), readFile: vi.fn(), rm: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: native.spawnSync }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: native.readFile,
  rm: native.rm,
}));

import { collectManagedTauriHealthSnapshot, stopCommand } from '../../../scripts/dev/tauri-dev-manager';

const record: ManagedTauriInstanceRecord = {
  name: 'synthetic', projectRoot: 'D:\\synthetic\\exomind', rootPid: 100,
  webPort: 1420, hmrPort: 1421, rtPort: 9124,
  logPath: 'D:\\synthetic\\exomind\\.tmp\\synthetic.log',
  metaPath: 'D:\\synthetic\\exomind\\.tmp\\synthetic.json',
  startedAt: '2026-11-13T03:00:00.000Z', enableWatch: false, target: 'desktop',
  rootExecutablePath: 'C:\\Bun\\bun.exe', rootCreationDate: '2026-11-13T03:00:00.000Z',
};

function processTree(): ManagedWindowsProcessInfo[] {
  return [
    { ProcessId: 100, ParentProcessId: 1, Name: 'bun.exe', ExecutablePath: 'C:\\Bun\\bun.exe', CreationDate: record.rootCreationDate },
    { ProcessId: 200, ParentProcessId: 100, Name: 'exomind.exe', ExecutablePath: 'D:\\synthetic\\exomind.exe', CreationDate: '2026-11-13T03:00:01.000Z' },
    { ProcessId: 300, ParentProcessId: 200, Name: 'conhost.exe', ExecutablePath: 'C:\\Windows\\conhost.exe', CreationDate: '2026-11-13T03:00:02.000Z' },
  ];
}

describe('tauri-dev-manager process boundary', () => {
  let processes: ManagedWindowsProcessInfo[];
  let stoppedPids: number[];
  let beforeReadProcess: ((pid: number) => void) | undefined;
  let stopFailure: boolean;
  let suppressWebListeners: boolean;
  let extraListeners: Array<{ LocalPort: number; OwningProcess: number }>;

  beforeEach(() => {
    vi.resetAllMocks();
    processes = processTree();
    stoppedPids = [];
    beforeReadProcess = undefined;
    stopFailure = false;
    suppressWebListeners = false;
    extraListeners = [];
    native.readFile.mockImplementation(async (filePath: string) => filePath.endsWith('Cargo.toml')
      ? '[package]\nname = "exomind"\n' : JSON.stringify(record));
    native.rm.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal !== 0) throw new Error('Tests must never signal a real process');
      if (!processes.some((processInfo) => processInfo.ProcessId === pid)) {
        throw Object.assign(new Error('synthetic process absent'), { code: 'ESRCH' });
      }
      return true;
    });
    native.spawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'taskkill') {
        const pid = Number(args[args.indexOf('/PID') + 1]);
        stoppedPids.push(pid);
        if (!stopFailure) processes = processes.filter((processInfo) => processInfo.ProcessId !== pid);
        return { status: stopFailure ? 1 : 0, stdout: '', stderr: stopFailure ? 'synthetic stop failure' : '' };
      }
      if (command !== 'powershell.exe') throw new Error(`Unexpected native command: ${command}`);
      const script = args[args.indexOf('-Command') + 1];
      const nativeStop = script.match(/\[ManagedTauriProcessStop\]::Stop\((\d+),/);
      if (nativeStop) {
        const pid = Number(nativeStop[1]);
        stoppedPids.push(pid);
        if (!stopFailure) processes = processes.filter((processInfo) => processInfo.ProcessId !== pid);
        return { status: stopFailure ? 1 : 0, stdout: '', stderr: stopFailure ? 'synthetic stop failure' : '' };
      }
      if (script.includes('Get-NetTCPConnection')) {
        const listeners = !suppressWebListeners && processes.some((processInfo) => processInfo.ProcessId === 200)
          ? [{ LocalPort: 1420, OwningProcess: 200 }, { LocalPort: 1421, OwningProcess: 200 }] : [];
        return { status: 0, stdout: JSON.stringify([...listeners, ...extraListeners]), stderr: '' };
      }
      const pidFilter = script.match(/ProcessId=(\d+)/);
      if (pidFilter) beforeReadProcess?.(Number(pidFilter[1]));
      return { status: 0, stdout: JSON.stringify(pidFilter
        ? processes.filter((processInfo) => processInfo.ProcessId === Number(pidFilter[1])) : processes), stderr: '' };
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('collects Android root identity and process ownership before stop', async () => {
    const snapshot = await collectManagedTauriHealthSnapshot({ ...record, target: 'android' });

    expect(snapshot.processes).toEqual(processTree());
    expect(snapshot.rootPidAlive).toBe(true);
  });

  it('stops descendants once, leaf first, without a PID tree kill', async () => {
    await stopCommand(new Map([['--name', record.name]]));

    expect(stoppedPids).toEqual([300, 200, 100]);
    expect(native.spawnSync.mock.calls.some(([command]) => command === 'taskkill')).toBe(false);
    expect(native.rm).toHaveBeenCalledOnce();
  });

  it('stops an Android development instance with the same ownership checks', async () => {
    native.readFile.mockResolvedValue(JSON.stringify({ ...record, target: 'android' }));

    await stopCommand(new Map([['--name', record.name]]));

    expect(stoppedPids).toEqual([300, 200, 100]);
    expect(native.rm).toHaveBeenCalledOnce();
  });

  it('preserves metadata and rejects stop when the root identity changed', async () => {
    processes[0].CreationDate = '2026-11-13T04:00:00.000Z';

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/ownership|identity/i);

    expect(stoppedPids).toEqual([]);
    expect(native.rm).not.toHaveBeenCalled();
  });

  it('rechecks each candidate identity before native termination and keeps metadata on reuse', async () => {
    beforeReadProcess = (pid) => {
      if (pid === 300) processes[2].CreationDate = '2026-11-13T04:00:00.000Z';
    };

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/identity/i);

    expect(stoppedPids).toEqual([]);
    expect(native.rm).not.toHaveBeenCalled();
  });

  it('preserves metadata on a native stop failure', async () => {
    stopFailure = true;

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/synthetic stop failure/);

    expect(native.rm).not.toHaveBeenCalled();
  });

  it('does not report stopped when orphan listeners cannot be attributed', async () => {
    processes = processes.filter((processInfo) => processInfo.ProcessId !== 100);

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/activity|ownership|listener/i);

    expect(stoppedPids).toEqual([]);
    expect(native.rm).not.toHaveBeenCalled();
  });

  it('retains metadata for an orphan child even without Web or HMR listeners', async () => {
    processes = processes.filter((processInfo) => processInfo.ProcessId !== 100);
    suppressWebListeners = true;

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/activity|ownership|listener/i);

    expect(stoppedPids).toEqual([]);
    expect(native.rm).not.toHaveBeenCalled();
  });

  it.each([9124, 9223])('retains metadata when only port %i is still listening', async (port) => {
    processes = [];
    extraListeners = [{ LocalPort: port, OwningProcess: 400 }];

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/activity|ownership|listener/i);

    expect(stoppedPids).toEqual([]);
    expect(native.rm).not.toHaveBeenCalled();
  });

  it('removes metadata when the root, descendants and all listeners are confirmed absent', async () => {
    processes = [];

    await stopCommand(new Map([['--name', record.name]]));

    expect(stoppedPids).toEqual([]);
    expect(native.rm).toHaveBeenCalledOnce();
  });

  it('retains metadata when a child starts after the cleanup snapshot', async () => {
    beforeReadProcess = (pid) => {
      if (pid === 100) {
        processes.push({
          ProcessId: 400, ParentProcessId: 100, Name: 'node.exe',
          ExecutablePath: 'C:\\synthetic\\node.exe', CreationDate: '2026-11-13T03:00:03.000Z',
        });
      }
    };

    await expect(stopCommand(new Map([['--name', record.name]]))).rejects.toThrow(/not confirmed/);

    expect(stoppedPids).toEqual([300, 200, 100]);
    expect(processes.map((processInfo) => processInfo.ProcessId)).toEqual([400]);
    expect(native.rm).not.toHaveBeenCalled();
  });
});
