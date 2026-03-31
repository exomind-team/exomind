#!/usr/bin/env bun

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  appendManagedTauriLogSessionStart,
  collectManagedTauriCleanupPids,
  evaluateManagedTauriInstanceHealth,
  resolveManagedTauriInstancePaths,
  type ManagedTauriInstanceHealthSnapshot,
  type ManagedTauriInstanceRecord,
  type TauriDevTarget,
} from './tauri-dev-manager-lib';

type CommandName = 'start' | 'list' | 'status' | 'stop' | 'logs' | 'prune';

type ParsedArgs = {
  command: CommandName;
  flags: Map<string, string | true>;
};

const PROJECT_ROOT = process.cwd();
const DEFAULT_WEB_PORT = 1420;
const WINDOWS_TOOL_PROCESS_NAMES = new Set(['bun.exe', 'cargo.exe', 'node.exe', 'vite.exe']);
const desktopProcessNameCache = new Map<string, Promise<string | null>>();

type WindowsProcessInfo = {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
};

type PortListenerInfo = {
  LocalPort: number;
  OwningProcess: number;
};

function printUsage(): never {
  console.log(`Usage:
  bun scripts/dev/tauri-dev-manager.ts start --name <instance> [--target desktop|android] [--web-port <port>] [--hmr-port <port>] [--watch]
  bun scripts/dev/tauri-dev-manager.ts list
  bun scripts/dev/tauri-dev-manager.ts stop --name <instance>
  bun scripts/dev/tauri-dev-manager.ts logs --name <instance> [--tail <n>] [--follow]
  bun scripts/dev/tauri-dev-manager.ts prune`);
  process.exit(1);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  if (!commandRaw) {
    printUsage();
  }

  const command = commandRaw as CommandName;
  if (!['start', 'list', 'status', 'stop', 'logs', 'prune'].includes(command)) {
    printUsage();
  }

  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags.set(token, true);
      continue;
    }

    flags.set(token, next);
    index += 1;
  }

  return { command, flags };
}

function getFlagValue(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function hasFlag(flags: Map<string, string | true>, name: string): boolean {
  return flags.get(name) === true;
}

function parsePortFlag(flags: Map<string, string | true>, name: string): number | undefined {
  const raw = getFlagValue(flags, name);
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`invalid port for ${name}: ${raw}`);
  }

  return parsed;
}

async function findFreePort(preferred?: number): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && preferred) {
        void findFreePort().then(resolve, reject);
        return;
      }

      reject(error);
    });
    server.listen({ port: preferred ?? 0, host: '0.0.0.0', exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureRegistryDir(registryDir: string): Promise<void> {
  await mkdir(registryDir, { recursive: true });
}

async function readInstanceRecord(metaPath: string): Promise<ManagedTauriInstanceRecord | null> {
  try {
    const content = await readFile(metaPath, 'utf8');
    return JSON.parse(content) as ManagedTauriInstanceRecord;
  } catch {
    return null;
  }
}

async function writeInstanceRecord(record: ManagedTauriInstanceRecord): Promise<void> {
  await ensureRegistryDir(path.dirname(record.metaPath));
  await writeFile(record.metaPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function listRecords(): Promise<ManagedTauriInstanceRecord[]> {
  const registryDir = resolveManagedTauriInstancePaths(PROJECT_ROOT, 'default').registryDir;
  if (!(await fileExists(registryDir))) {
    return [];
  }

  const entries = await readdir(registryDir);
  const records: ManagedTauriInstanceRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    const metaPath = path.join(registryDir, entry);
    const record = await readInstanceRecord(metaPath);
    if (record) {
      records.push(record);
    }
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
}

async function readTail(logPath: string, lineCount: number): Promise<string> {
  const content = await readFile(logPath, 'utf8');
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - lineCount)).join('\n');
}

function escapePowerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeJsonArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function runPowerShellJson<T>(script: string): T[] {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      script,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || 'powershell health probe failed');
  }

  const raw = result.stdout.trim();
  if (!raw) {
    return [];
  }

  return normalizeJsonArray(JSON.parse(raw) as T | T[] | null);
}

function getDescendantProcesses(processes: WindowsProcessInfo[], rootPid: number): WindowsProcessInfo[] {
  const childrenByParent = new Map<number, WindowsProcessInfo[]>();
  for (const processInfo of processes) {
    const siblings = childrenByParent.get(processInfo.ParentProcessId) ?? [];
    siblings.push(processInfo);
    childrenByParent.set(processInfo.ParentProcessId, siblings);
  }

  const descendants: WindowsProcessInfo[] = [];
  const queue = [...(childrenByParent.get(rootPid) ?? [])];
  const seen = new Set<number>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.ProcessId)) {
      continue;
    }

    seen.add(current.ProcessId);
    descendants.push(current);
    queue.push(...(childrenByParent.get(current.ProcessId) ?? []));
  }

  return descendants;
}

async function resolveDesktopProcessBaseName(projectRoot: string): Promise<string | null> {
  const cached = desktopProcessNameCache.get(projectRoot);
  if (cached) {
    return await cached;
  }

  const pending = (async () => {
    try {
      const cargoTomlPath = path.join(projectRoot, 'src-tauri', 'Cargo.toml');
      const cargoToml = await readFile(cargoTomlPath, 'utf8');
      const packageSectionMatch = cargoToml.match(/\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m);
      return packageSectionMatch?.[1]?.trim() || null;
    } catch {
      return null;
    }
  })();

  desktopProcessNameCache.set(projectRoot, pending);
  return await pending;
}

function matchesDesktopProcessName(name: string, expectedBaseName: string | null): boolean {
  const normalized = name.trim().toLowerCase();
  if (expectedBaseName) {
    const expected = expectedBaseName.trim().toLowerCase();
    return normalized === expected || normalized === `${expected}.exe`;
  }

  return !WINDOWS_TOOL_PROCESS_NAMES.has(normalized);
}

function groupListenerPidsByPort(portListeners: PortListenerInfo[], port: number): number[] {
  return [...new Set(
    portListeners
      .filter((listener) => listener.LocalPort === port)
      .map((listener) => listener.OwningProcess)
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )];
}

async function collectManagedTauriHealthSnapshot(
  record: ManagedTauriInstanceRecord,
): Promise<ManagedTauriInstanceHealthSnapshot> {
  const rootPidAlive = isPidAlive(record.rootPid);
  const portProbeScript = [
    `$ports = @(${record.webPort}, ${record.hmrPort})`,
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object LocalPort, OwningProcess | ConvertTo-Json -Compress",
  ].join('; ');
  const portListeners = runPowerShellJson<PortListenerInfo>(portProbeScript);
  const webPortPids = groupListenerPidsByPort(portListeners, record.webPort);
  const hmrPortPids = groupListenerPidsByPort(portListeners, record.hmrPort);

  if (record.target !== 'desktop') {
    return {
      rootPidAlive,
      webPortListening: webPortPids.length > 0,
      hmrPortListening: hmrPortPids.length > 0,
      webPortPids,
      hmrPortPids,
    };
  }

  if (!rootPidAlive) {
    return {
      rootPidAlive,
      webPortListening: webPortPids.length > 0,
      hmrPortListening: hmrPortPids.length > 0,
      appProcessAlive: false,
      webPortPids,
      hmrPortPids,
      appPids: [],
    };
  }

  const expectedDesktopProcess = await resolveDesktopProcessBaseName(record.projectRoot);
  const processes = runPowerShellJson<WindowsProcessInfo>(
    'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress',
  );
  const descendants = getDescendantProcesses(processes, record.rootPid);
  const appPids = descendants
    .filter((processInfo) => matchesDesktopProcessName(processInfo.Name, expectedDesktopProcess))
    .map((processInfo) => processInfo.ProcessId);

  return {
    rootPidAlive,
    webPortListening: webPortPids.length > 0,
    hmrPortListening: hmrPortPids.length > 0,
    appProcessAlive: appPids.length > 0,
    webPortPids,
    hmrPortPids,
    appPids,
  };
}

function stopWindowsProcess(pid: number): void {
  const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0 && isPidAlive(pid)) {
    throw new Error(result.stderr || result.stdout || `failed to stop PID ${pid}`);
  }
}

function parseTarget(flags: Map<string, string | true>): TauriDevTarget {
  const raw = getFlagValue(flags, '--target');
  if (!raw) return 'desktop';
  if (raw === 'desktop' || raw === 'android') return raw;
  throw new Error(`invalid target: ${raw} (expected desktop or android)`);
}

async function startCommand(flags: Map<string, string | true>): Promise<void> {
  const target = parseTarget(flags);
  const explicitWebPort = parsePortFlag(flags, '--web-port');
  const webPort = explicitWebPort ?? await findFreePort(DEFAULT_WEB_PORT);
  const hmrPort = parsePortFlag(flags, '--hmr-port') ?? await findFreePort(webPort + 1);
  const requestedName = getFlagValue(flags, '--name') ?? `${target}-${webPort}`;
  const enableWatch = hasFlag(flags, '--watch');

  const paths = resolveManagedTauriInstancePaths(PROJECT_ROOT, requestedName);
  await ensureRegistryDir(paths.registryDir);

  const existing = await readInstanceRecord(paths.metaPath);
  if (existing && isPidAlive(existing.rootPid)) {
    throw new Error(`instance already running: ${paths.name} (PID ${existing.rootPid})`);
  }

  const env = {
    ...process.env,
    EXOMIND_WEB_PORT: String(webPort),
    EXOMIND_HMR_PORT: String(hmrPort),
    EXOMIND_TAURI_INSTANCE_NAME: paths.name,
    ...(enableWatch ? { EXOMIND_TAURI_ENABLE_WATCH: '1' } : {}),
  };
  const startedAt = new Date().toISOString();

  await appendManagedTauriLogSessionStart(paths.logPath, {
    name: paths.name,
    target,
    webPort,
    hmrPort,
    startedAt,
  });

  const logHandle = await open(paths.logPath, 'a');
  const tauriArgs = target === 'android'
    ? ['run', 'tauri', 'android', 'dev']
    : ['run', 'tauri', 'dev'];
  const child = spawn(process.execPath, tauriArgs, {
    cwd: PROJECT_ROOT,
    detached: true,
    env,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
    windowsHide: true,
  });
  await logHandle.close();
  child.unref();

  const record: ManagedTauriInstanceRecord = {
    name: paths.name,
    projectRoot: PROJECT_ROOT,
    rootPid: child.pid ?? -1,
    webPort,
    hmrPort,
    logPath: paths.logPath,
    metaPath: paths.metaPath,
    startedAt,
    enableWatch,
    target,
  };
  await writeInstanceRecord(record);

  await Bun.sleep(1200);
  if (!isPidAlive(record.rootPid)) {
    const logHint = (await fileExists(paths.logPath)) ? await readTail(paths.logPath, 40) : '';
    await rm(paths.metaPath, { force: true });
    throw new Error(`instance exited too early: ${paths.name}\n${logHint}`);
  }

  console.log(`started: ${paths.name}`);
  console.log(`target: ${target}`);
  console.log(`pid: ${record.rootPid}`);
  console.log(`web: http://localhost:${webPort}`);
  console.log(`hmr: ${hmrPort}`);
  console.log(`log: ${paths.logPath}`);
  console.log(`meta: ${paths.metaPath}`);
}

async function listCommand(): Promise<void> {
  const records = await listRecords();
  if (records.length === 0) {
    console.log('no managed tauri dev instances');
    return;
  }

  const rows = await Promise.all(records.map(async (record) => {
    const snapshot = await collectManagedTauriHealthSnapshot(record);
    const health = evaluateManagedTauriInstanceHealth(record, snapshot);
    return {
      name: record.name,
      target: record.target ?? 'desktop',
      pid: record.rootPid,
      status: health.status,
      detail: health.detail,
      web: `http://localhost:${record.webPort}`,
      hmr: record.hmrPort,
      log: path.relative(PROJECT_ROOT, record.logPath),
    };
  }));

  console.table(rows);
}

async function stopCommand(flags: Map<string, string | true>): Promise<void> {
  const requestedName = getFlagValue(flags, '--name');
  if (!requestedName) {
    throw new Error('stop requires --name');
  }

  const paths = resolveManagedTauriInstancePaths(PROJECT_ROOT, requestedName);
  const record = await readInstanceRecord(paths.metaPath);
  if (!record) {
    throw new Error(`instance not found: ${paths.name}`);
  }

  const snapshot = await collectManagedTauriHealthSnapshot(record);
  const cleanupPids = collectManagedTauriCleanupPids(record, snapshot);

  for (const pid of cleanupPids) {
    stopWindowsProcess(pid);
  }

  await rm(paths.metaPath, { force: true });
  console.log(`stopped: ${paths.name}`);
}

async function logsCommand(flags: Map<string, string | true>): Promise<void> {
  const requestedName = getFlagValue(flags, '--name');
  if (!requestedName) {
    throw new Error('logs requires --name');
  }

  const tail = parsePortFlag(flags, '--tail') ?? 80;
  const follow = hasFlag(flags, '--follow');
  const paths = resolveManagedTauriInstancePaths(PROJECT_ROOT, requestedName);
  if (!(await fileExists(paths.logPath))) {
    throw new Error(`log not found: ${paths.logPath}`);
  }

  if (!follow) {
    console.log(await readTail(paths.logPath, tail));
    return;
  }

  const ps = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-Content -LiteralPath '${escapePowerShellLiteral(paths.logPath)}' -Tail ${tail} -Wait`,
    ],
    {
      stdio: 'inherit',
      windowsHide: false,
    },
  );

  await new Promise<number>((resolve, reject) => {
    ps.on('error', reject);
    ps.on('close', (code) => resolve(code ?? 0));
  });
}

async function pruneCommand(): Promise<void> {
  const records = await listRecords();
  let removed = 0;

  for (const record of records) {
    const snapshot = await collectManagedTauriHealthSnapshot(record);
    const cleanupPids = collectManagedTauriCleanupPids(record, snapshot);

    if (snapshot.rootPidAlive || cleanupPids.length > 0) {
      continue;
    }

    await rm(record.metaPath, { force: true });
    removed += 1;
  }

  console.log(`pruned: ${removed}`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'start':
      await startCommand(flags);
      return;
    case 'list':
    case 'status':
      await listCommand();
      return;
    case 'stop':
      await stopCommand(flags);
      return;
    case 'logs':
      await logsCommand(flags);
      return;
    case 'prune':
      await pruneCommand();
      return;
    default:
      printUsage();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
