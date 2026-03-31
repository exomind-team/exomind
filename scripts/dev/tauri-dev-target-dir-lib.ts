import path from 'node:path';

type EnvLike = Record<string, string | undefined>;

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

export function resolveTauriDevTargetDir(projectRoot: string, env: EnvLike): string {
  const explicitTargetDir = env.EXOMIND_TAURI_TARGET_DIR?.trim();
  if (explicitTargetDir) {
    return path.resolve(projectRoot, explicitTargetDir);
  }

  return path.join(
    projectRoot,
    'target',
    'tauri-dev',
    resolveTauriDevInstanceName(env)
  );
}
