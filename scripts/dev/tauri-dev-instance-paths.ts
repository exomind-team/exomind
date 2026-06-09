#!/usr/bin/env bun

import path from 'node:path';

type EnvLike = Record<string, string | undefined>;

export type TauriDevInstancePaths = {
  instanceName: string;
  stateRootDir: string;
  webviewMainDataDir: string;
  webviewOverlayDataRoot: string;
  appDataDir: string;
  runtimeDataDir: string;
  legacySharedAppDataDir?: string;
  legacySharedWebviewMainDataDir?: string;
  legacySharedRuntimeDir?: string;
  mcpBridgeBasePort: number;
};

function sanitizeInstanceSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'default';
}

export function resolveTauriDevInstanceName(env: EnvLike): string {
  const explicitName = env.EXOMIND_TAURI_INSTANCE_NAME?.trim();
  if (explicitName) {
    return sanitizeInstanceSegment(explicitName);
  }

  const webPort = env.EXOMIND_WEB_PORT?.trim();
  if (webPort && /^\d+$/.test(webPort)) {
    return `web-${webPort}`;
  }

  return 'default';
}

function resolveMcpBridgeBasePort(env: EnvLike): number {
  const webPort = env.EXOMIND_WEB_PORT?.trim();
  if (webPort && /^\d+$/.test(webPort)) {
    const parsed = Number.parseInt(webPort, 10);
    return 9223 + Math.max(0, parsed - 1420);
  }

  return 9223;
}

function resolveOptionalSeedPath(
  value: string | undefined,
  projectRoot: string,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(projectRoot, trimmed);
}

export function resolveTauriDevInstancePaths(
  projectRoot: string,
  env: EnvLike,
): TauriDevInstancePaths {
  const instanceName = resolveTauriDevInstanceName(env);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const stateRootDir = path.join(
    resolvedProjectRoot,
    '.tmp',
    'tauri-dev-state',
    instanceName,
  );
  const appDataDir = path.join(stateRootDir, 'app-data');
  const runtimeDataDir = path.join(appDataDir, 'runtime');
  const legacySharedAppDataDir = resolveOptionalSeedPath(
    env.EXOMIND_DEV_LEGACY_SHARED_APP_DATA_DIR,
    resolvedProjectRoot,
  );
  const legacySharedWebviewMainDataDir = resolveOptionalSeedPath(
    env.EXOMIND_DEV_LEGACY_SHARED_WEBVIEW_MAIN_DATA_DIR,
    resolvedProjectRoot,
  );
  const legacySharedRuntimeDir = resolveOptionalSeedPath(
    env.EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR,
    resolvedProjectRoot,
  );

  return {
    instanceName,
    stateRootDir,
    webviewMainDataDir: path.join(stateRootDir, 'webview', 'main'),
    webviewOverlayDataRoot: path.join(stateRootDir, 'webview', 'overlay'),
    appDataDir,
    runtimeDataDir,
    legacySharedAppDataDir,
    legacySharedWebviewMainDataDir,
    legacySharedRuntimeDir,
    mcpBridgeBasePort: resolveMcpBridgeBasePort(env),
  };
}

if (import.meta.main) {
  const projectRoot = process.argv[2]?.trim() || process.cwd();
  const payload = resolveTauriDevInstancePaths(projectRoot, process.env);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
