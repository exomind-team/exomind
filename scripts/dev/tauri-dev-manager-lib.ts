import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolveTauriDevInstanceName } from './tauri-dev-target-dir-lib';

export type ManagedTauriInstancePaths = {
  name: string;
  registryDir: string;
  metaPath: string;
  logPath: string;
};

export type TauriDevTarget = 'desktop' | 'android';

export type ManagedTauriInstanceRecord = {
  name: string;
  projectRoot: string;
  rootPid: number;
  webPort: number;
  hmrPort: number;
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
};

export type ManagedTauriInstanceHealth = {
  status: 'running' | 'degraded' | 'stale';
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

export function formatManagedTauriLogSessionStart(input: ManagedTauriLogSessionStart): string {
  const timestamp = input.startedAt.trim();
  return [
    '',
    `===== manager session start [${timestamp}] name=${input.name} target=${input.target} web=${input.webPort} hmr=${input.hmrPort} =====`,
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
  if (snapshot.rootPidAlive) {
    return uniquePositivePids([record.rootPid]);
  }

  return uniquePositivePids([
    ...(snapshot.webPortPids ?? []),
    ...(snapshot.hmrPortPids ?? []),
    ...(snapshot.appPids ?? []),
  ]);
}
