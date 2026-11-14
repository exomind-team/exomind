using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// A finite command and its two independent owners. No shell, PID enumeration,
// image-name termination, process-tree reconstruction, or output pipes.
public static class SupervisedCommandNative {
  const uint QueryProcess=0x1000, Terminate=1, Synchronize=0x100000;
  const uint Suspended=4, NoWindow=0x08000000, UnicodeEnvironment=0x400;
  const uint JobQuery=4, JobTerminate=8, StillActive=259;
  const uint InheritHandle=1, Infinite=0xffffffff, WaitTimeout=258;
  const uint Read=0x80000000, Write=0x40000000, ShareRead=1, ShareWrite=2;
  const uint OpenExisting=3, OpenAlways=4, Normal=0x80;
  const int SharedWriteTimeoutMilliseconds=600, SharedWriteRetryMilliseconds=10;
  static readonly IntPtr Invalid=new IntPtr(-1);
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=1048576 };

  public class Config {
    public int version; public string runId,artifactDir,executable,cwd;
    public string[] args; public Dictionary<string,string> environment;
    public int timeoutMs,noProgressTimeoutMs,bootstrapTimeoutMs,heartbeatTimeoutMs,pollIntervalMs,cleanupTimeoutMs;
  }
  public class Identity { public int pid; public string createdFileTime,executablePath; }
  public class Status {
    public int version=1; public string runId,phase,updatedAt,lastProgressAt;
    public long heartbeatSequence; public Identity supervisor,watchdog,command;
    public string cpu100ns="0"; public long stdoutBytes,stderrBytes;
    public string commandStartedAt;
  }
  [StructLayout(LayoutKind.Sequential)] struct Security { public int size; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved,desktop,title; public int x,y,width,height,charsX,charsY,fill;
    public uint flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking;
    public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint size,IntPtr length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint exitCode);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder path,ref uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint exitCode);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exitCode);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,ref Security security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);

  static string FileAt(string dir,string file) { return Path.Combine(dir,file); }
  static string Now() { return DateTime.UtcNow.ToString("o"); }
  static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static void Close(ref IntPtr handle) { if(handle!=IntPtr.Zero&&handle!=Invalid) CloseHandle(handle); handle=IntPtr.Zero; }
  static T Load<T>(string path) {
    // Status is atomically replaced by the other owner; readers must allow
    // deletion/rename while retaining their already opened snapshot handle.
    using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
    using(var reader=new StreamReader(stream,Encoding.UTF8,true)) return Json.Deserialize<T>(reader.ReadToEnd());
  }
  static string JobName(string run) { return "Local\\ExoMindFinite-"+Guid.Parse(run).ToString("N"); }
  static void SharedFileWrite(Action write) {
    var deadline=Stopwatch.StartNew();
    for(;;) {
      try {write();return;}
      catch(IOException error) {
        int code=error.HResult&0xffff;
        if((code!=32&&code!=33)||deadline.ElapsedMilliseconds>=SharedWriteTimeoutMilliseconds) throw;
        Thread.Sleep(SharedWriteRetryMilliseconds);
      }
    }
  }
  static void Diagnostic(string dir,string role,string phase,Exception error) {
    try {File.WriteAllText(FileAt(dir,role+"-error.json"),Json.Serialize(new {phase=phase,type=error.GetType().FullName,hresult=error.HResult,at=Now()}),new UTF8Encoding(false));}catch{}
  }
  static void Atomic(string path,object value) {
    string temporary=path+".tmp-"+Guid.NewGuid().ToString("N");
    try { File.WriteAllText(temporary,Json.Serialize(value),new UTF8Encoding(false));
      SharedFileWrite(delegate {if(File.Exists(path)) File.Replace(temporary,path,null); else File.Move(temporary,path);});
    } finally { if(File.Exists(temporary)) File.Delete(temporary); }
  }
  static void Result(string dir,string run,string reason,int? code,bool cleaned) {
    string path=FileAt(dir,"result.json"),temp=path+".tmp-"+Guid.NewGuid().ToString("N");
    try {
      File.WriteAllText(temp,Json.Serialize(new {version=1,runId=run,reason=reason,exitCode=code,finishedAt=Now(),cleanup=new {confirmed=cleaned,jobClosed=cleaned}}),new UTF8Encoding(false));
      // Atomic winner, no persistent claim file that a crashed writer can strand.
      try { File.Move(temp,path); } catch(IOException) { if(!File.Exists(path)) throw; }
    } finally { if(File.Exists(temp)) File.Delete(temp); }
  }
  static Identity Identify(IntPtr process,int pid) {
    long c,e,k,u; Check(GetProcessTimes(process,out c,out e,out k,out u));
    uint count=32768; var path=new StringBuilder((int)count); Check(QueryFullProcessImageName(process,0,path,ref count));
    return new Identity {pid=pid,createdFileTime=c.ToString(),executablePath=path.ToString()};
  }
  static IntPtr Verified(Identity expected) {
    if(expected==null||expected.pid<=0||String.IsNullOrEmpty(expected.createdFileTime)||String.IsNullOrEmpty(expected.executablePath)) throw new InvalidOperationException("Missing supervisor identity");
    IntPtr handle=OpenProcess(QueryProcess|Terminate|Synchronize,false,(uint)expected.pid);
    if(handle==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try { Identity actual=Identify(handle,expected.pid);
      if(actual.createdFileTime!=expected.createdFileTime||!String.Equals(actual.executablePath,expected.executablePath,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Supervisor identity mismatch; termination refused");
      return handle;
    } catch { CloseHandle(handle); throw; }
  }
  static string Quote(string input) {
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char ch in input) {
      if(ch=='\\') { slashes++;continue; }
      if(ch=='\"') { result.Append('\\',slashes*2+1);result.Append(ch);slashes=0;continue; }
      result.Append('\\',slashes);slashes=0;result.Append(ch);
    }
    result.Append('\\',slashes*2);return result.Append('"').ToString();
  }
  static ProcessInfo Start(string exe,string[] args,string cwd,string output,string error,bool suspended,Dictionary<string,string> overrides) {
    IntPtr outFile=IntPtr.Zero,errFile=IntPtr.Zero,input=IntPtr.Zero,env=IntPtr.Zero;
    ProcessInfo info=new ProcessInfo();
    try {
      var sa=new Security {size=Marshal.SizeOf(typeof(Security)),inherit=1};
      outFile=CreateFile(output,Write,ShareRead|ShareWrite,ref sa,OpenAlways,Normal,IntPtr.Zero); Check(outFile!=Invalid);
      errFile=CreateFile(error,Write,ShareRead|ShareWrite,ref sa,OpenAlways,Normal,IntPtr.Zero); Check(errFile!=Invalid);
      input=CreateFile("NUL",Read,ShareRead|ShareWrite,ref sa,OpenExisting,Normal,IntPtr.Zero); Check(input!=Invalid);
      var startup=new Startup {cb=Marshal.SizeOf(typeof(Startup)),flags=0x100,input=input,output=outFile,error=errFile};
      var line=new StringBuilder(Quote(exe));foreach(string arg in args??new string[0]) line.Append(" ").Append(Quote(arg));
      if(overrides!=null&&overrides.Count>0) {
        var values=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach(System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables()) values[(string)entry.Key]=(string)entry.Value;
        foreach(var entry in overrides) values[entry.Key]=entry.Value;
        var block=new StringBuilder();foreach(var entry in values) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');block.Append('\0');
        env=Marshal.StringToHGlobalUni(block.ToString());
      }
      Check(CreateProcess(exe,line,IntPtr.Zero,IntPtr.Zero,true,NoWindow|UnicodeEnvironment|(suspended?Suspended:0),env,cwd,ref startup,out info));
      return info;
    } finally { Close(ref outFile);Close(ref errFile);Close(ref input);if(env!=IntPtr.Zero) Marshal.FreeHGlobal(env); }
  }
  static Accounting Count(IntPtr job) { Accounting info;Check(QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));return info; }
  static bool Drain(ref IntPtr job,int timeout) {
    if(job==IntPtr.Zero) return true;
    bool clean=false;
    try { Check(TerminateJobObject(job,222));var clock=Stopwatch.StartNew();
      while(clock.ElapsedMilliseconds<timeout) { if(Count(job).active==0) {clean=true;break;}Thread.Sleep(20); }
    } finally { Close(ref job); }
    return clean;
  }
  static long Length(string path) { return File.Exists(path)?new FileInfo(path).Length:0; }
  static bool Cancelled(string dir,string run) {
    string path=FileAt(dir,"cancel.json");if(!File.Exists(path)) return false;
    try {return (string)Load<Dictionary<string,object>>(path)["runId"]==run;} catch {return false;}
  }
  static void Secure(string dir) {
    var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);
    acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,
      InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    Directory.SetAccessControl(dir,acl);
  }
  static int Supervisor(string dir) {
    Config config=Load<Config>(FileAt(dir,"input.json"));IntPtr job=IntPtr.Zero;ProcessInfo command=new ProcessInfo(),watchdog=new ProcessInfo();
    var state=new Status {runId=config.runId,phase="bootstrapping",supervisor=Identify(GetCurrentProcess(),Process.GetCurrentProcess().Id)};
    bool assigned=false,cleaned=false;string reason="bootstrap_failed";int? exitCode=null;
    Action pulse=delegate {state.heartbeatSequence++;state.updatedAt=Now();Atomic(FileAt(dir,"status.json"),state);};
    try {
      job=CreateJobObject(IntPtr.Zero,JobName(config.runId));Check(job!=IntPtr.Zero);
      if(Marshal.GetLastWin32Error()==183) throw new InvalidOperationException("Job identity already exists");
      var limits=new ExtendedLimits();limits.basic.flags=0x2000;
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      command=Start(config.executable,config.args,config.cwd,FileAt(dir,"stdout.log"),FileAt(dir,"stderr.log"),true,config.environment);
      state.command=Identify(command.process,(int)command.pid);
      Check(AssignProcessToJobObject(job,command.process));assigned=true;pulse();
      watchdog=Start(state.supervisor.executablePath,new[]{"watchdog",dir},dir,FileAt(dir,"watchdog.log"),FileAt(dir,"watchdog-error.log"),false,null);
      state.watchdog=Identify(watchdog.process,(int)watchdog.pid);pulse();
      var bootstrap=Stopwatch.StartNew();
      while(!File.Exists(FileAt(dir,"watchdog.ready.json"))) {
        if(WaitForSingleObject(watchdog.process,0)==0) {reason="watchdog_failed";throw new InvalidOperationException("Watchdog exited before readiness");}
        if(bootstrap.ElapsedMilliseconds>=config.bootstrapTimeoutMs) {reason="watchdog_failed";throw new TimeoutException("Watchdog readiness deadline");}
        Thread.Sleep(config.pollIntervalMs);pulse();
      }
      state.phase="running";state.commandStartedAt=Now();state.lastProgressAt=Now();pulse();
      Atomic(FileAt(dir,"receipt.json"),new {version=1,runId=config.runId,dir=dir,supervisor=state.supervisor,watchdog=state.watchdog,
        paths=new {status=FileAt(dir,"status.json"),result=FileAt(dir,"result.json"),stdout=FileAt(dir,"stdout.log"),stderr=FileAt(dir,"stderr.log"),bootstrap=FileAt(dir,"bootstrap.log")}});
      Check(ResumeThread(command.thread)!=0xffffffff);Close(ref command.thread);
      var elapsed=Stopwatch.StartNew();long lastProgress=0,lastCpu=0,lastOut=0,lastErr=0;
      while(true) {
        if(WaitForSingleObject(command.process,0)==0) {uint code;Check(GetExitCodeProcess(command.process,out code));exitCode=unchecked((int)code);reason=code==0?"completed":"exit_nonzero";break;}
        if(WaitForSingleObject(watchdog.process,0)==0) {reason="watchdog_failed";break;}
        if(Cancelled(dir,config.runId)) {reason="cancelled";break;}
        Accounting counts=Count(job);long cpu=counts.user+counts.kernel,output=Length(FileAt(dir,"stdout.log")),error=Length(FileAt(dir,"stderr.log"));
        if(cpu>lastCpu||output>lastOut||error>lastErr) {lastProgress=elapsed.ElapsedMilliseconds;state.lastProgressAt=Now();}
        lastCpu=cpu;lastOut=output;lastErr=error;state.cpu100ns=cpu.ToString();state.stdoutBytes=output;state.stderrBytes=error;pulse();
        if(elapsed.ElapsedMilliseconds>=config.timeoutMs||DateTime.UtcNow>=DateTime.Parse(state.commandStartedAt).ToUniversalTime().AddMilliseconds(config.timeoutMs)) {reason="total_timeout";break;}
        if(elapsed.ElapsedMilliseconds-lastProgress>=config.noProgressTimeoutMs) {reason="idle_timeout";break;}
        Thread.Sleep(config.pollIntervalMs);
      }
    } catch(Exception error) {
      Diagnostic(dir,"supervisor",state.phase,error);
      if(reason=="bootstrap_failed"&&state.phase=="running") reason="supervisor_failed";
    }
    finally {
      state.phase="cleaning";try {pulse();}catch{}
      bool unassignedClean=true;
      if(!assigned&&command.process!=IntPtr.Zero) {unassignedClean=TerminateProcess(command.process,223)&&WaitForSingleObject(command.process,(uint)config.cleanupTimeoutMs)==0;}
      try {cleaned=Drain(ref job,config.cleanupTimeoutMs)&&unassignedClean;}catch{cleaned=false;}
      if(cleaned&&watchdog.process!=IntPtr.Zero&&WaitForSingleObject(watchdog.process,0)!=0) {
        // The watchdog owns another Job handle. Have it close that empty Job
        // before claiming jobClosed; never depend on only the supervisor close.
        Atomic(FileAt(dir,"job.drained.json"),new {runId=config.runId});var release=Stopwatch.StartNew();
        while(!File.Exists(FileAt(dir,"watchdog.released.json"))&&WaitForSingleObject(watchdog.process,0)!=0&&release.ElapsedMilliseconds<config.cleanupTimeoutMs) {Thread.Sleep(20);try{pulse();}catch{}}
        if(!File.Exists(FileAt(dir,"watchdog.released.json"))&&WaitForSingleObject(watchdog.process,0)!=0) {
          reason="watchdog_failed";cleaned=TerminateProcess(watchdog.process,225)&&WaitForSingleObject(watchdog.process,(uint)config.cleanupTimeoutMs)==0;
        }
      }
      if(!cleaned) reason="cleanup_failed";
      Result(dir,config.runId,reason,exitCode,cleaned);
      state.phase="terminal";try {pulse();}catch{}
      Close(ref command.thread);Close(ref command.process);
      if(watchdog.process!=IntPtr.Zero) WaitForSingleObject(watchdog.process,(uint)config.cleanupTimeoutMs);
      Close(ref watchdog.thread);Close(ref watchdog.process);
    }
    return 0;
  }
  static int Watchdog(string dir) {
    Config config=Load<Config>(FileAt(dir,"input.json"));Status initial=Load<Status>(FileAt(dir,"status.json"));
    IntPtr supervisor=IntPtr.Zero,job=IntPtr.Zero;bool cleaned=false;string reason="ownership_refused";
    try {
      if(initial.runId!=config.runId) throw new InvalidOperationException("Run identity mismatch");
      supervisor=Verified(initial.supervisor);
      job=OpenJobObject(JobQuery|JobTerminate,false,JobName(config.runId));Check(job!=IntPtr.Zero);
      Atomic(FileAt(dir,"watchdog.ready.json"),new {runId=config.runId,watchdog=Identify(GetCurrentProcess(),Process.GetCurrentProcess().Id)});
      var clock=Stopwatch.StartNew();long sequence=-1,lastBeat=0;long? taskDeadline=null;DateTime? taskDeadlineUtc=null;
      while(!File.Exists(FileAt(dir,"result.json"))) {
        if(WaitForSingleObject(supervisor,0)==0) {reason="supervisor_lost";break;}
        if(File.Exists(FileAt(dir,"job.drained.json"))) {
          if((string)Load<Dictionary<string,object>>(FileAt(dir,"job.drained.json"))["runId"]!=config.runId||Count(job).active!=0) throw new InvalidOperationException("Job drainage not confirmed");
          Close(ref job);Atomic(FileAt(dir,"watchdog.released.json"),new {runId=config.runId});
          var final=Stopwatch.StartNew();
          while(!File.Exists(FileAt(dir,"result.json"))&&WaitForSingleObject(supervisor,0)!=0&&final.ElapsedMilliseconds<config.cleanupTimeoutMs) Thread.Sleep(20);
          if(File.Exists(FileAt(dir,"result.json"))) return 0;
          reason=WaitForSingleObject(supervisor,0)==0?"supervisor_lost":"heartbeat_timeout";break;
        }
        Status state=null;try {state=Load<Status>(FileAt(dir,"status.json"));}catch{}
        if(state!=null&&state.runId==config.runId) {
          if(state.heartbeatSequence!=sequence) {sequence=state.heartbeatSequence;lastBeat=clock.ElapsedMilliseconds;}
          if(taskDeadline==null&&!String.IsNullOrEmpty(state.commandStartedAt)) {
            taskDeadlineUtc=DateTime.Parse(state.commandStartedAt).ToUniversalTime().AddMilliseconds(config.timeoutMs);
            long remaining=(long)(taskDeadlineUtc.Value-DateTime.UtcNow).TotalMilliseconds;
            taskDeadline=clock.ElapsedMilliseconds+Math.Max(0,Math.Min(config.timeoutMs,remaining))+config.pollIntervalMs*2;
          }
        }
        if(taskDeadline.HasValue&&(clock.ElapsedMilliseconds>=taskDeadline.Value||DateTime.UtcNow>=taskDeadlineUtc.Value)) {reason="total_timeout";break;}
        if(!taskDeadline.HasValue&&clock.ElapsedMilliseconds>=config.bootstrapTimeoutMs) {reason="watchdog_failed";break;}
        if(clock.ElapsedMilliseconds-lastBeat>=config.heartbeatTimeoutMs) {reason="heartbeat_timeout";break;}
        Thread.Sleep(config.pollIntervalMs);
      }
      if(File.Exists(FileAt(dir,"result.json"))) return 0;
      if(WaitForSingleObject(supervisor,0)!=0) {Check(TerminateProcess(supervisor,224));Check(WaitForSingleObject(supervisor,(uint)config.cleanupTimeoutMs)==0);}
      cleaned=Drain(ref job,config.cleanupTimeoutMs);
      Result(dir,config.runId,cleaned?reason:"cleanup_failed",null,cleaned);
    } catch(Exception error) {Diagnostic(dir,"watchdog","guarding",error);Result(dir,config.runId,"ownership_refused",null,false);}
    finally {Close(ref supervisor);Close(ref job);}
    return 0;
  }
  public static int Main(string[] args) {
    try {
      if(args.Length!=2||!Path.IsPathRooted(args[1])) return 2;
      if(args[0]=="prepare") {Secure(args[1]);return 0;}
      if(args[0]=="supervisor") return Supervisor(args[1]);
      if(args[0]=="watchdog") return Watchdog(args[1]);
      return 2;
    } catch {return 3;}
  }
}
