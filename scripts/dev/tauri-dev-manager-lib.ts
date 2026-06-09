import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolveTauriDevInstanceName } from './tauri-dev-target-dir-lib';

export type ManagedTauriInstancePaths = {
  name: string;
  registryDir: string;
  metaPath: string;
  logPath: string;
};

export type ManagedWindowsProcessInfo = {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  CommandLine?: string | null;
};

export type TauriDevTarget = 'desktop' | 'android';

export type ManagedTauriInstanceRecord = {
  name: string;
  projectRoot: string;
  rootPid: number;
  webPort: number;
  hmrPort: number;
  rtPort?: number;
  logPath: string;
  metaPath: string;
  startedAt: string;
  enableWatch: boolean;
  target: TauriDevTarget;
};

export type ManagedTauriLogSessionStart = {
  name: string;
  target: TauriDevTarget;
  webPort: number;
  hmrPort: number;
  rtPort?: number;
  bridgePort?: number;
  startedAt: string;
};

export type ManagedTauriInstanceHealthSnapshot = {
  rootPidAlive: boolean;
  webPortListening: boolean;
  hmrPortListening: boolean;
  appProcessAlive?: boolean;
  webPortPids?: number[];
  hmrPortPids?: number[];
  appPids?: number[];
  processes?: ManagedWindowsProcessInfo[];
};

export type ManagedTauriInstanceHealth = {
  status: 'starting' | 'running' | 'degraded' | 'stale';
  detail: string;
};

export type BuildManagedTauriCommandInput = {
  projectRoot: string;
  name: string;
  webPort: number;
  hmrPort: number;
  logPath: string;
  enableWatch?: boolean;
};

function escapeForCmdDoubleQuotes(value: string): string {
  return value.replaceAll('"', '""');
}

export function resolveManagedTauriInstancePaths(
  projectRoot: string,
  rawName: string,
): ManagedTauriInstancePaths {
  const name = resolveTauriDevInstanceName({
    EXOMIND_TAURI_INSTANCE_NAME: rawName,
  });
  const registryDir = path.resolve(projectRoot, '.tmp', 'tauri-dev-instances');

  return {
    name,
    registryDir,
    metaPath: path.join(registryDir, `${name}.json`),
    logPath: path.join(registryDir, `${name}.log`),
  };
}

export function buildManagedTauriCommand(input: BuildManagedTauriCommandInput): string {
  const commands = [
    `cd /d "${escapeForCmdDoubleQuotes(input.projectRoot)}"`,
    `set "EXOMIND_WEB_PORT=${input.webPort}"`,
    `set "EXOMIND_HMR_PORT=${input.hmrPort}"`,
    `set "EXOMIND_TAURI_INSTANCE_NAME=${escapeForCmdDoubleQuotes(input.name)}"`,
  ];

  if (input.enableWatch) {
    commands.push('set "EXOMIND_TAURI_ENABLE_WATCH=1"');
  }

  commands.push(
    `bun run tauri dev > "${escapeForCmdDoubleQuotes(input.logPath)}" 2>&1`,
  );

  return commands.join(' && ');
}

function collectListeningPortLabels(
  record: ManagedTauriInstanceRecord,
  snapshot: ManagedTauriInstanceHealthSnapshot,
): string[] {
  const labels: string[] = [];
  if (snapshot.webPortListening) {
    labels.push(`web=${record.webPort}`);
  }
  if (snapshot.hmrPortListening) {
    labels.push(`hmr=${record.hmrPort}`);
  }
  return labels;
}

function uniquePositivePids(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => Number.isInteger(value) && value > 0))];
}

const WINDOWS_TOOL_PROCESS_NAMES = new Set(['bun.exe', 'cargo.exe', 'node.exe', 'vite.exe']);

function getDescendantProcesses(processes: ManagedWindowsProcessInfo[], rootPid: number): ManagedWindowsProcessInfo[] {
  const childrenByParent = new Map<number, ManagedWindowsProcessInfo[]>();
  for (const processInfo of processes) {
    const siblings = childrenByParent.get(processInfo.ParentProcessId) ?? [];
    siblings.push(processInfo);
    childrenByParent.set(processInfo.ParentProcessId, siblings);
  }

  const descendants: ManagedWindowsProcessInfo[] = [];
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

function matchesDesktopProcessName(name: string, expectedBaseName: string | null): boolean {
  const normalized = name.trim().toLowerCase();
  if (expectedBaseName) {
    const expected = expectedBaseName.trim().toLowerCase();
    return normalized === expected || normalized === `${expected}.exe`;
  }

  return !WINDOWS_TOOL_PROCESS_NAMES.has(normalized);
}

function matchesExpectedExecutablePath(
  commandLine: string | null | undefined,
  expectedExecutablePath: string | null | undefined,
): boolean {
  if (!commandLine || !expectedExecutablePath) {
    return false;
  }

  return commandLine.toLowerCase().includes(expectedExecutablePath.trim().toLowerCase());
}

export function collectManagedDesktopAppPids(input: {
  processes: ManagedWindowsProcessInfo[];
  rootPid: number;
  expectedBaseName: string | null;
  expectedExecutablePath?: string | null;
}): number[] {
  const descendants = getDescendantProcesses(input.processes, input.rootPid);
  const descendantPids = descendants
    .filter((processInfo) => matchesDesktopProcessName(processInfo.Name, input.expectedBaseName))
    .map((processInfo) => processInfo.ProcessId);

  const pathMatchedPids = input.processes
    .filter((processInfo) => matchesExpectedExecutablePath(processInfo.CommandLine, input.expectedExecutablePath))
    .map((processInfo) => processInfo.ProcessId);

  return uniquePositivePids([...descendantPids, ...pathMatchedPids]);
}

const DESKTOP_APP_STARTUP_GRACE_MS = 90_000;

function isRecentDesktopStartup(startedAt: string, now = Date.now()): boolean {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return false;
  }

  return (now - startedAtMs) < DESKTOP_APP_STARTUP_GRACE_MS;
}

export function formatManagedTauriLogSessionStart(input: ManagedTauriLogSessionStart): string {
  const timestamp = input.startedAt.trim();
  const rtPortLabel = typeof input.rtPort === 'number' ? ` rt=${input.rtPort}` : '';
  const bridgePortLabel = typeof input.bridgePort === 'number' ? ` bridge=${input.bridgePort}` : '';
  return [
    '',
    `===== manager session start [${timestamp}] name=${input.name} target=${input.target} web=${input.webPort} hmr=${input.hmrPort}${rtPortLabel}${bridgePortLabel} =====`,
    '',
  ].join('\n');
}

export async function appendManagedTauriLogSessionStart(
  logPath: string,
  input: ManagedTauriLogSessionStart,
): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, formatManagedTauriLogSessionStart(input), 'utf8');
}

export function evaluateManagedTauriInstanceHealth(
  record: ManagedTauriInstanceRecord,
  snapshot: ManagedTauriInstanceHealthSnapshot,
): ManagedTauriInstanceHealth {
  const listeningLabels = collectListeningPortLabels(record, snapshot);

  if (!snapshot.rootPidAlive) {
    if (listeningLabels.length > 0) {
      return {
        status: 'stale',
        detail: `root pid exited; lingering listeners: ${listeningLabels.join(', ')}`,
      };
    }

    return {
      status: 'stale',
      detail: 'root pid exited',
    };
  }

  if (record.target === 'desktop' && snapshot.appProcessAlive === false) {
    if (isRecentDesktopStartup(record.startedAt)) {
      if (listeningLabels.length > 0) {
        return {
          status: 'starting',
          detail: `desktop app process warming up; active listeners: ${listeningLabels.join(', ')}`,
        };
      }

      return {
        status: 'starting',
        detail: 'desktop app process warming up',
      };
    }

    if (listeningLabels.length > 0) {
      return {
        status: 'stale',
        detail: `desktop app process missing; lingering listeners: ${listeningLabels.join(', ')}`,
      };
    }

    return {
      status: 'stale',
      detail: 'desktop app process missing',
    };
  }

  const missingLabels: string[] = [];
  if (!snapshot.webPortListening) {
    missingLabels.push(`web=${record.webPort}`);
  }
  if (!snapshot.hmrPortListening) {
    missingLabels.push(`hmr=${record.hmrPort}`);
  }

  if (missingLabels.length > 0) {
    return {
      status: 'degraded',
      detail: `missing listeners: ${missingLabels.join(', ')}`,
    };
  }

  return {
    status: 'running',
    detail: 'ok',
  };
}

export function collectManagedTauriCleanupPids(
  record: ManagedTauriInstanceRecord,
  snapshot: ManagedTauriInstanceHealthSnapshot,
): number[] {
  const rootPids = uniquePositivePids([
    ...(snapshot.rootPidAlive ? [record.rootPid] : []),
    ...(snapshot.webPortPids ?? []),
    ...(snapshot.hmrPortPids ?? []),
    ...(snapshot.appPids ?? []),
  ]);

  if (!snapshot.processes || snapshot.processes.length === 0 || rootPids.length === 0) {
    return rootPids;
  }

  const descendantPids = rootPids.flatMap((pid) =>
    getDescendantProcesses(snapshot.processes ?? [], pid).map((processInfo) => processInfo.ProcessId),
  );

  return uniquePositivePids([...rootPids, ...descendantPids]);
}
