import { spawnSync } from 'node:child_process';
import { parseProcessCreationTime, type ManagedWindowsProcessInfo } from './tauri-dev-manager-lib';

const PROCESS_STOP_NATIVE_TYPE = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class ManagedTauriProcessStop {
  private const uint ProcessTerminate = 0x0001;
  private const uint ProcessQueryLimitedInformation = 0x1000;
  private const uint Synchronize = 0x00100000;
  private const uint StopWaitMilliseconds = 5000;
  private const long WindowsEpochMilliseconds = 11644473600000L;

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint WaitForSingleObject(IntPtr process, uint milliseconds);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);

  public static void Stop(uint pid, long expectedCreatedAt, string expectedPath) {
    IntPtr process = OpenProcess(ProcessTerminate | ProcessQueryLimitedInformation | Synchronize, false, pid);
    if (process == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 87) return;
      throw new Win32Exception(error);
    }
    try {
      if (expectedCreatedAt >= 0) {
        long created, exited, kernel, user;
        if (!GetProcessTimes(process, out created, out exited, out kernel, out user))
          throw new Win32Exception(Marshal.GetLastWin32Error());
        if (created / 10000L - WindowsEpochMilliseconds != expectedCreatedAt)
          throw new InvalidOperationException("Process creation identity changed; termination refused.");
      }
      if (!String.IsNullOrEmpty(expectedPath)) {
        uint length = 32768;
        StringBuilder actualPath = new StringBuilder((int)length);
        if (!QueryFullProcessImageName(process, 0, actualPath, ref length))
          throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!String.Equals(actualPath.ToString(), expectedPath, StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("Process executable identity changed; termination refused.");
      }
      if (!TerminateProcess(process, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      uint waitResult = WaitForSingleObject(process, StopWaitMilliseconds);
      if (waitResult == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (waitResult != 0) throw new TimeoutException("Process termination was not confirmed.");
    } finally { CloseHandle(process); }
  }
}
`;

export function stopManagedWindowsProcess(processInfo: ManagedWindowsProcessInfo): void {
  const pid = processInfo.ProcessId;
  const createdAt = parseProcessCreationTime(processInfo.CreationDate);
  const executablePath = processInfo.ExecutablePath?.trim().replace(/^"+|"+$/g, '') ?? '';
  if (!Number.isInteger(pid) || pid <= 0 || (processInfo.CreationDate && (createdAt === null || createdAt < 0))
    || (createdAt === null && !executablePath)) {
    throw new Error(`cannot stop PID ${pid}: process identity is unavailable`);
  }

  // Validation and termination use one opened handle, not a second PID lookup.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${PROCESS_STOP_NATIVE_TYPE}\n'@`,
    `[ManagedTauriProcessStop]::Stop(${pid}, ${createdAt ?? -1}, '${executablePath.replaceAll("'", "''")}')`,
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `failed to stop PID ${pid}`, {
      cause: result.error,
    });
  }
}
