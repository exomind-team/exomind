// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stopManagedWindowsProcess } from '../../../scripts/dev/tauri-dev-process-stop';

const roots: string[] = [];
const sentinels: ChildProcess[] = [];
const fixture = resolve('tests/unit/scripts/fixtures/supervised-command-fixture.cjs');
function config(mode: string, overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'exomind-supervised-')); roots.push(root);
  const artifactDir = join(root, 'run');
  return { version: 1, artifactDir, executable: process.execPath, args: [fixture, mode, artifactDir], cwd: process.cwd(),
    timeoutMs: 5000, noProgressTimeoutMs: 1200, bootstrapTimeoutMs: 10000, heartbeatTimeoutMs: 1300, ...overrides };
}
async function waitFor<T>(read: () => T | undefined, timeoutMs = 8500): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { const found = read(); if (found !== undefined) return found; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('bounded supervised fixture did not reach its expected state');
}
afterEach(async () => {
  // ChildProcess.kill uses the retained owned process handle; never enumerate images.
  for (const child of sentinels.splice(0)) if (child.exitCode === null) child.kill();
  const temporaryRoot = resolve(tmpdir()).toLowerCase();
  for (const root of roots.splice(0)) {
    const owned = resolve(root);
    if (!isAbsolute(owned) || dirname(owned).toLowerCase() !== temporaryRoot || !basename(owned).startsWith('exomind-supervised-')) {
      throw new Error('Refusing cleanup outside the generated supervised fixture root');
    }
    // result.json confirms command Job drainage, not that both short guard
    // processes have already returned from Main and released their exe/CWD.
    const deadline = Date.now() + 3500;
    while (true) {
      try { rmSync(owned, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY','EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code ?? '') || Date.now() >= deadline) {
          throw new Error(`Owned fixture cleanup unconfirmed; evidence retained at ${owned}`, { cause: error });
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
});

describe.runIf(process.platform === 'win32')('finite supervised Windows commands', () => {
  it.each([['success','completed',0],['failure','exit_nonzero',7]] as const)('records %s only after owned cleanup', async (mode,reason,exitCode) => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config(mode);
    const receipt = await api.startSupervisedCommand(task);
    expect(receipt.supervisor.pid).toBeGreaterThan(0); expect(receipt.supervisor.createdFileTime).toMatch(/^\d+$/);
    expect(typeof receipt.supervisor.createdFileTime).toBe('string');
    const result = await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined);
    expect(result).toMatchObject({ reason, exitCode, cleanup: { confirmed: true, jobClosed: true } });
    expect(readFileSync(receipt.paths.stdout,'utf8') + readFileSync(receipt.paths.stderr,'utf8')).toContain(`finite-${mode}`);
  }, 18000);
  it('times out silent work even though supervisor heartbeat advances', async () => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config('silent');
    await api.startSupervisedCommand(task);
    const result = await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined);
    expect(result).toMatchObject({ reason: 'idle_timeout', cleanup: { confirmed: true } });
  }, 18000);
  it('survives a bounded external reader holding the status file exclusively', async () => {
    const api=await import('../../../scripts/dev/supervised-command');
    const task=config('lock-status',{noProgressTimeoutMs:2500,heartbeatTimeoutMs:2500});
    await api.startSupervisedCommand(task);
    const result=await waitFor(()=>{try{return api.readSupervisedCommand(task.artifactDir).result??undefined;}catch(error){if(String(error).includes('unreadable'))return undefined;throw error;}});
    expect(result).toMatchObject({reason:'completed',exitCode:0,cleanup:{confirmed:true,jobClosed:true}});
  },18000);
  it('accepts real job CPU progress without output', async () => {
    const api = await import('../../../scripts/dev/supervised-command');
    const busy = config('cpu', { noProgressTimeoutMs: 500 }); await api.startSupervisedCommand(busy);
    expect((await waitFor(() => api.readSupervisedCommand(busy.artifactDir).result ?? undefined)).reason).toBe('completed');
  }, 18000);
  it('enforces total deadline even on chatty work', async () => {
    const api = await import('../../../scripts/dev/supervised-command');
    const chatty = config('chatty', { timeoutMs: 1700 }); await api.startSupervisedCommand(chatty);
    expect((await waitFor(() => api.readSupervisedCommand(chatty.artifactDir).result ?? undefined)).reason).toBe('total_timeout');
  }, 18000);
  it('repeatedly reads real atomic heartbeat replacements without stopping healthy work', async () => {
    const api = await import('../../../scripts/dev/supervised-command');
    const task = config('chatty', { timeoutMs: 1800 });
    await api.startSupervisedCommand(task);
    const deadline = Date.now() + 5000;
    let observations = 0; let result;
    while (Date.now() < deadline) {
      for (let burst = 0; burst < 16; burst += 1) {
        const observed = api.readSupervisedCommand(task.artifactDir);
        observations += 1;
        if (observed.result) { result = observed.result; break; }
      }
      if (result) break;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    expect(observations).toBeGreaterThan(100);
    expect(result).toMatchObject({ reason: 'total_timeout', cleanup: { confirmed: true, jobClosed: true } });
  }, 18000);
  it('returns before a descendant-held stdout ends and cleans that descendant on root exit', async () => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config('descendant-pipe');
    const receipt = await api.startSupervisedCommand(task);
    const result = await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined, 2500);
    expect(result).toMatchObject({ reason: 'completed', cleanup: { confirmed: true, jobClosed: true } });
    expect(readFileSync(receipt.paths.stdout,'utf8')).toMatch(/descendant-pid=\d+/);
  }, 18000);
  it('cancels only its job and leaves an unrelated same-executable sentinel alive', async () => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config('silent');
    const sentinel = spawn(process.execPath,[fixture,'silent'],{stdio:'ignore',windowsHide:true}); sentinels.push(sentinel);
    await api.startSupervisedCommand(task); api.cancelSupervisedCommand(task.artifactDir);
    const result = await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined);
    expect(result.reason).toBe('cancelled'); expect(sentinel.exitCode).toBeNull();
  }, 18000);
  it.each([['suspend-supervisor','heartbeat_timeout'],['kill-watchdog','watchdog_failed']] as const)('independently detects %s', async (mode,reason) => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config(mode,{noProgressTimeoutMs:4000});
    await api.startSupervisedCommand(task);
    const result = await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined);
    expect(result).toMatchObject({ reason, cleanup: { confirmed: true, jobClosed: true } });
  }, 18000);
  it('watchdog closes the owned job after unexpected supervisor death', async () => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config('silent',{noProgressTimeoutMs:4000});
    const sentinel = spawn(process.execPath,[fixture,'silent'],{stdio:'ignore',windowsHide:true}); sentinels.push(sentinel);
    await api.startSupervisedCommand(task);
    const status = await waitFor(() => { const current=api.readSupervisedCommand(task.artifactDir).status; return current?.phase==='running'?current:undefined; });
    const identity=status.supervisor;
    const milliseconds=Number(BigInt(identity.createdFileTime)/10000n-11644473600000n);
    stopManagedWindowsProcess({ ProcessId:identity.pid, ParentProcessId:0, Name:'supervised-command-native.exe', CreationDate:new Date(milliseconds).toISOString(), ExecutablePath:identity.executablePath });
    const result = await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined);
    expect(result).toMatchObject({reason:'supervisor_lost',cleanup:{confirmed:true,jobClosed:true}});
    expect(sentinel.exitCode).toBeNull();
  }, 18000);
  it('fails bootstrap explicitly for a non-executable file without running it', async () => {
    const api = await import('../../../scripts/dev/supervised-command'); const task = config('success');
    const invalid=join(roots[roots.length-1],'not-a-native-command.exe');writeFileSync(invalid,'synthetic invalid PE');task.executable=invalid;
    await api.startSupervisedCommand(task);
    expect((await waitFor(() => api.readSupervisedCommand(task.artifactDir).result ?? undefined)).reason).toBe('bootstrap_failed');
  }, 18000);
});
