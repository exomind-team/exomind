import path from 'node:path';
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
