import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ResolveTauriExecutableInput = {
  projectRoot: string;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
};

export function resolveTauriExecutable(input: ResolveTauriExecutableInput): string {
  const platform = input.platform ?? process.platform;
  const exists = input.exists ?? existsSync;
  const localTauri = join(
    input.projectRoot,
    'node_modules',
    '.bin',
    platform === 'win32' ? 'tauri.cmd' : 'tauri'
  );

  // Prefer project-local tauri CLI（优先使用项目本地 tauri CLI）
  if (exists(localTauri)) {
    return localTauri;
  }

  // Fallback to PATH executable（回退到 PATH 中的 tauri 命令）
  return platform === 'win32' ? 'tauri.cmd' : 'tauri';
}
