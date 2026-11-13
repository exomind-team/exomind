// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stopManagedWindowsProcess } from '../../../scripts/dev/tauri-dev-process-stop';
import type { ManagedWindowsProcessInfo } from '../../../scripts/dev/tauri-dev-manager-lib';

const native = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: native.spawnSync }));

const processInfo: ManagedWindowsProcessInfo = {
  ProcessId: 200, ParentProcessId: 100, Name: 'exomind.exe',
  CreationDate: '2026-11-13T03:00:00.000Z', ExecutablePath: "D:\\synthetic's folder\\exomind.exe",
};

describe('managed Windows process stop adapter', () => {
  beforeEach(() => {
    native.spawnSync.mockReset();
    native.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
  });

  it('passes the expected identity and terminates only the validated handle', () => {
    stopManagedWindowsProcess(processInfo);

    const [command, args, options] = native.spawnSync.mock.calls[0];
    const script: string = args[args.indexOf('-Command') + 1];
    expect(command).toBe('powershell.exe');
    expect(options.windowsHide).toBe(true);
    expect(script).toContain(`[ManagedTauriProcessStop]::Stop(200, ${Date.parse(processInfo.CreationDate!)}, 'D:\\synthetic''s folder\\exomind.exe')`);
    expect(script).toContain('GetProcessTimes(process,');
    expect(script).toContain('QueryFullProcessImageName(process,');
    expect(script).toContain('TerminateProcess(process, 1)');
    expect(script).toContain('WaitForSingleObject(process, StopWaitMilliseconds)');
    expect(script).not.toContain('taskkill');
  });

  it('accepts PowerShell serialized CIM creation dates without losing identity', () => {
    const createdAt = Date.parse(processInfo.CreationDate!);
    stopManagedWindowsProcess({ ...processInfo, CreationDate: `/Date(${createdAt})/` });

    expect(native.spawnSync.mock.calls[0][1].at(-1)).toContain(`[ManagedTauriProcessStop]::Stop(200, ${createdAt},`);
  });

  it.each([
    { ...processInfo, ProcessId: 0 },
    { ...processInfo, ProcessId: 1.5 },
    { ...processInfo, CreationDate: 'invalid creation time' },
    { ...processInfo, CreationDate: null, ExecutablePath: null },
  ])('rejects an unavailable or invalid process identity before native work', (input) => {
    expect(() => stopManagedWindowsProcess(input)).toThrow(/identity/);
    expect(native.spawnSync).not.toHaveBeenCalled();
  });

  it('fails closed on native permission or identity errors without a PID fallback', () => {
    native.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'Access is denied' });

    expect(() => stopManagedWindowsProcess(processInfo)).toThrow('Access is denied');
    expect(native.spawnSync).toHaveBeenCalledOnce();
  });

  it('preserves the platform spawn error as the cause', () => {
    const error = Object.assign(new Error('powershell unavailable'), { code: 'ENOENT' });
    native.spawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', error });

    expect(() => stopManagedWindowsProcess(processInfo)).toThrow(expect.objectContaining({ cause: error }));
  });
});
