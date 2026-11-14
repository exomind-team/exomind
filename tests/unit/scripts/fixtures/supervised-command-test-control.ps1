param([ValidateSet('suspend-supervisor','kill-watchdog')][string]$Action)
$ErrorActionPreference = 'Stop'
$targetIdentity = ConvertFrom-Json $env:SUPERVISED_TEST_TARGET
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SupervisedFixtureControl {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr p,out long c,out long e,out long k,out long u);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr p,uint flags,StringBuilder path,ref uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr p,uint exitCode);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr p);
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr p);
  public static void Apply(uint pid,string created,string path,bool suspend) {
    if(pid==0||String.IsNullOrEmpty(path)||String.IsNullOrEmpty(created)) throw new Exception("Missing owned fixture identity");
    IntPtr p=OpenProcess(0x1000u|(suspend?0x0800u:0x0001u),false,pid);
    if(p==IntPtr.Zero) throw new Exception("Cannot open owned fixture process");
    try {
      long c,e,k,u;uint size=32768;var actual=new StringBuilder((int)size);
      if(!GetProcessTimes(p,out c,out e,out k,out u)||c!=Int64.Parse(created)
        ||!QueryFullProcessImageName(p,0,actual,ref size)||!String.Equals(path,actual.ToString(),StringComparison.OrdinalIgnoreCase))
        throw new Exception("Owned fixture identity mismatch; operation refused");
      if(suspend) { if(NtSuspendProcess(p)!=0) throw new Exception("Cannot suspend owned fixture supervisor"); }
      else if(!TerminateProcess(p,88)) throw new Exception("Cannot stop owned fixture watchdog");
    } finally { CloseHandle(p); }
  }
}
'@
[SupervisedFixtureControl]::Apply([uint32]$targetIdentity.pid,[string]$targetIdentity.createdFileTime,[string]$targetIdentity.executablePath,($Action -eq 'suspend-supervisor'))
