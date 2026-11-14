import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const LIMITS = { bootstrapMs: 10000, heartbeatMs: 1500, pollMs: 100, cleanupMs: 3000, maxDurationMs: 86400000, readRetryMs: 100, readRetryPauseMs: 5 } as const;
const READ_RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));
class BootstrapFailure extends Error {
  constructor(message: string, readonly cleanupConfirmed: boolean) { super(message); }
}
export interface SupervisedCommandConfig {
  version: 1; artifactDir: string; executable: string; args: string[]; cwd: string;
  timeoutMs: number; noProgressTimeoutMs: number; bootstrapTimeoutMs?: number; heartbeatTimeoutMs?: number;
  environment?: Record<string, string>;
}
export interface ProcessIdentity { pid: number; createdFileTime: string; executablePath: string }
export interface LaunchReceipt {
  version: 1; runId: string; dir: string; supervisor: ProcessIdentity; watchdog: ProcessIdentity | null;
  paths: { status: string; result: string; stdout: string; stderr: string; bootstrap: string };
}
export interface RunStatus {
  runId: string; phase: 'bootstrapping' | 'running' | 'cleaning' | 'terminal';
  heartbeatSequence: number; updatedAt: string; lastProgressAt: string;
  supervisor: ProcessIdentity; watchdog: ProcessIdentity | null; command: ProcessIdentity | null;
}
export interface RunResult {
  runId: string; reason: string; exitCode: number | null; finishedAt: string;
  cleanup: { confirmed: boolean; jobClosed: boolean };
}

function noLinks(path: string): void {
  for (let current = path; ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Supervised paths cannot traverse symbolic links or junctions');
    if (dirname(current) === current) break;
  }
}
function absolute(value: unknown): value is string { return typeof value === 'string' && isAbsolute(value) && !value.includes('\0'); }
function milliseconds(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 100 || Number(value) > LIMITS.maxDurationMs) throw new Error(`${label} must explicitly specify bounded positive milliseconds`);
  return Number(value);
}
function normalize(input: SupervisedCommandConfig) {
  if (process.platform !== 'win32') throw new Error('Finite Job supervision requires Windows');
  if (input.version !== 1 || !absolute(input.artifactDir) || !absolute(input.executable) || !absolute(input.cwd)) throw new Error('Explicit absolute artifactDir, executable and cwd are required');
  if (!Array.isArray(input.args) || input.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('args must be literal strings');
  noLinks(input.artifactDir);
  if (input.environment && Object.entries(input.environment).some(([key, value]) => !key || /[=\0]/.test(key) || typeof value !== 'string' || value.includes('\0'))) throw new Error('Invalid explicit environment override');
  return { ...input, runId: randomUUID(), timeoutMs: milliseconds(input.timeoutMs, 'timeoutMs'),
    noProgressTimeoutMs: milliseconds(input.noProgressTimeoutMs, 'noProgressTimeoutMs'),
    bootstrapTimeoutMs: milliseconds(input.bootstrapTimeoutMs ?? LIMITS.bootstrapMs, 'bootstrapTimeoutMs'),
    heartbeatTimeoutMs: milliseconds(input.heartbeatTimeoutMs ?? LIMITS.heartbeatMs, 'heartbeatTimeoutMs'),
    pollIntervalMs: LIMITS.pollMs, cleanupTimeoutMs: LIMITS.cleanupMs };
}
function load<T>(path: string): T | undefined {
  const deadline = performance.now() + LIMITS.readRetryMs;
  let source: string;
  while (true) {
    try { source = readFileSync(path, 'utf8'); break; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return undefined;
      const remaining = deadline - performance.now();
      if (['EBUSY', 'EAGAIN', 'ETXTBSY'].includes(code ?? '') && remaining > 0) {
        // The writer is an independent native process, so a short synchronous
        // wait does not stall its File.Replace. Heartbeat is never progress.
        Atomics.wait(READ_RETRY_SIGNAL, 0, 0, Math.min(remaining, LIMITS.readRetryPauseMs));
        continue;
      }
      throw new Error('Supervised artifact is unreadable or invalid', { cause: error });
    }
  }
  // A malformed snapshot is not a sharing race and is never treated as absent.
  try { return JSON.parse(source) as T; }
  catch (error) { throw new Error('Supervised artifact is unreadable or invalid', { cause: error }); }
}
function atomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try { writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function paths(dir: string): LaunchReceipt['paths'] {
  return { status: join(dir, 'status.json'), result: join(dir, 'result.json'), stdout: join(dir, 'stdout.log'), stderr: join(dir, 'stderr.log'), bootstrap: join(dir, 'bootstrap.log') };
}
function terminal(dir: string, runId: string, reason: string, cleaned: boolean): void {
  const path = join(dir, 'result.json'); if (existsSync(path)) return;
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify({ version: 1, runId, reason, exitCode: null, finishedAt: new Date().toISOString(), cleanup: { confirmed: cleaned, jobClosed: cleaned } }), { flag: 'wx', mode: 0o600 });
  // Native finalizers use atomic create-once. Bootstrap has no competing writer
  // until a supervisor exists; its terminal is written only after owned exit.
  try { linkSync(temporary, path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || load<RunResult>(path)?.runId !== runId) throw error;
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
async function boundedChild(executable: string, args: string[], timeoutMs: number, log: string): Promise<void> {
  const output = openSync(log, 'a');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ['ignore', output, output], windowsHide: true });
      let timedOut = false; let killWait: ReturnType<typeof setTimeout> | undefined;
      const deadline = setTimeout(() => {
        timedOut = true; child.kill();
        killWait = setTimeout(() => reject(new BootstrapFailure('Bootstrap termination could not be confirmed', false)), LIMITS.cleanupMs);
      }, timeoutMs);
      const finish = (error?: Error) => { clearTimeout(deadline); if (killWait) clearTimeout(killWait); error ? reject(error) : resolve(); };
      child.once('error', error => finish(error));
      child.once('close', code => finish(timedOut ? new Error('Bootstrap deadline exceeded') : code === 0 ? undefined : new Error('Native bootstrap failed')));
    });
  } finally { closeSync(output); }
}
async function stopOwnedBootstrap(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const deadline = setTimeout(() => resolve(false), LIMITS.cleanupMs);
    child.once('exit', () => { clearTimeout(deadline); resolve(true); });
    child.kill(); // Retained ChildProcess handle, never a second PID lookup.
  });
}

export async function startSupervisedCommand(input: SupervisedCommandConfig): Promise<LaunchReceipt> {
  const config = normalize(input); const dir = config.artifactDir; const files = paths(dir);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error('artifactDir must be a fresh empty directory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ version: 1, runId: config.runId }), { flag: 'wx', mode: 0o600 });
  const native = join(dir, 'supervised-command-native.exe');
  const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const source = fileURLToPath(new URL('./supervised-command-native.cs', import.meta.url));
  let supervisor: ChildProcess | undefined;
  try {
    await boundedChild(compiler, ['/nologo', '/target:exe', '/platform:x64', `/out:${native}`, '/reference:System.Web.Extensions.dll', source], config.bootstrapTimeoutMs, files.bootstrap);
    await boundedChild(native, ['prepare', dir], config.bootstrapTimeoutMs, files.bootstrap);
    // Actual Windows DACL is applied before credentials/explicit env overrides.
    writeFileSync(join(dir, 'input.json'), JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    supervisor = spawn(native, ['supervisor', dir], { detached: true, stdio: 'ignore', windowsHide: true });
    let launchError: Error | undefined; supervisor.once('error', error => { launchError = error; });
    const deadline = Date.now() + config.bootstrapTimeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      const receipt = load<LaunchReceipt>(join(dir, 'receipt.json'));
      if (receipt?.runId === config.runId) { supervisor.unref(); return receipt; }
      const result = load<RunResult>(files.result); const status = load<RunStatus>(files.status);
      if (result && status?.supervisor) {
        const failed = { version: 1 as const, runId: config.runId, dir, supervisor: status.supervisor, watchdog: status.watchdog ?? null, paths: files };
        atomic(join(dir, 'receipt.json'), failed); supervisor.unref(); return failed;
      }
      if (supervisor.exitCode !== null || supervisor.signalCode !== null) throw new Error('Supervisor exited during bootstrap');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Supervisor/watchdog readiness deadline exceeded');
  } catch (error) {
    const supervisorExisted = typeof supervisor?.pid === 'number';
    const supervisorStopped = !supervisorExisted || await stopOwnedBootstrap(supervisor!);
    // Killing the bootstrap supervisor alone is not proof that a watchdog-held
    // Job handle has drained. Let the native owner confirm it; otherwise fail
    // closed with cleanup_failed rather than invent successful cleanup.
    let nativeResult = load<RunResult>(files.result);
    const until = Date.now() + LIMITS.cleanupMs + LIMITS.pollMs * 2;
    while (supervisorExisted && !nativeResult && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 25)); nativeResult = load<RunResult>(files.result);
    }
    const cleaned = (!(error instanceof BootstrapFailure) || error.cleanupConfirmed) && supervisorStopped
      && (!supervisorExisted || nativeResult?.cleanup.confirmed === true);
    terminal(dir, config.runId, cleaned ? 'bootstrap_failed' : 'cleanup_failed', cleaned);
    throw new Error(`Supervised bootstrap failed; inspect ${files.result}`, { cause: error });
  }
}

export function readSupervisedCommand(dir: string) {
  if (!absolute(dir)) throw new Error('Explicit absolute artifact directory required'); noLinks(dir);
  const owner = load<{ runId: string }>(join(dir, 'owner.json'));
  if (!owner?.runId) throw new Error('Owned run identity is missing');
  const observation = { receipt: load<LaunchReceipt>(join(dir, 'receipt.json')), status: load<RunStatus>(join(dir, 'status.json')), result: load<RunResult>(join(dir, 'result.json')) };
  for (const value of Object.values(observation)) if (value && value.runId !== owner.runId) throw new Error('Run identity mismatch; refusing foreign artifact');
  return observation;
}
export function cancelSupervisedCommand(dir: string) {
  const observation = readSupervisedCommand(dir);
  if (observation.result) return { accepted: false, alreadyTerminal: true };
  const owner = load<{ runId: string }>(join(dir, 'owner.json'))!;
  atomic(join(dir, 'cancel.json'), { runId: owner.runId, requestedAt: new Date().toISOString() });
  return { accepted: true, alreadyTerminal: false };
}

if (import.meta.main) {
  try {
    const [action, flag, value, ...extra] = process.argv.slice(2);
    if (!value || extra.length) throw new Error('Use start --config <JSON>, status --dir <dir>, or cancel --dir <dir>');
    let result: unknown;
    if (action === 'start' && flag === '--config') result = await startSupervisedCommand(JSON.parse(readFileSync(value, 'utf8')));
    else if (action === 'status' && flag === '--dir') result = readSupervisedCommand(value);
    else if (action === 'cancel' && flag === '--dir') result = cancelSupervisedCommand(value);
    else throw new Error('Unknown supervised command');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { process.stderr.write((error instanceof Error ? error.message : 'Supervised command failed') + '\n'); process.exitCode = 1; }
}
