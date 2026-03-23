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
  const localBinDir = join(input.projectRoot, 'node_modules', '.bin');
  const localCandidates = platform === 'win32' ? ['tauri.exe', 'tauri.cmd', 'tauri'] : ['tauri'];

  // Prefer project-local tauri CLI（优先使用项目本地 tauri CLI）
  for (const candidate of localCandidates) {
    const localTauri = join(localBinDir, candidate);
    if (exists(localTauri)) {
      return localTauri;
    }
  }

  // Fallback to PATH executable（回退到 PATH 中的 tauri 命令）
  // Use extensionless command on Windows so PATHEXT can resolve exe/cmd variants.
  //（Windows 使用无扩展命令，让 PATHEXT 自动匹配 exe/cmd）
  return 'tauri';
}
