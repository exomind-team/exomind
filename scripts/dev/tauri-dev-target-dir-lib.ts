import fs from 'node:fs';
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

function parseTomlStringLiteral(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed.length < 2) {
    return null;
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"');
  }

  return null;
}

function parseCargoBuildTargetRoot(configContent: string): string | null {
  let inBuildSection = false;

  for (const line of configContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^[\]]+)\]$/);
    if (sectionMatch) {
      inBuildSection = sectionMatch[1].trim() === 'build';
      continue;
    }

    const dottedKeyMatch = trimmed.match(/^build\.target-dir\s*=\s*(.+)$/);
    if (dottedKeyMatch) {
      return parseTomlStringLiteral(dottedKeyMatch[1]);
    }

    if (!inBuildSection) {
      continue;
    }

    const targetDirMatch = trimmed.match(/^target-dir\s*=\s*(.+)$/);
    if (targetDirMatch) {
      return parseTomlStringLiteral(targetDirMatch[1]);
    }
  }

  return null;
}

function resolveCargoConfiguredTargetRoot(projectRoot: string): string | null {
  const configCandidates = [
    path.join(projectRoot, '.cargo', 'config.toml'),
    path.join(projectRoot, '.cargo', 'config'),
  ];

  for (const configPath of configCandidates) {
    if (!fs.existsSync(configPath)) {
      continue;
    }

    const rawConfig = fs.readFileSync(configPath, 'utf8');
    const configuredTargetRoot = parseCargoBuildTargetRoot(rawConfig);
    if (!configuredTargetRoot) {
      continue;
    }

    return path.resolve(projectRoot, configuredTargetRoot);
  }

  return null;
}

export function resolveTauriDevTargetDir(projectRoot: string, env: EnvLike): string {
  const explicitTargetDir = env.EXOMIND_TAURI_TARGET_DIR?.trim();
  if (explicitTargetDir) {
    return path.resolve(projectRoot, explicitTargetDir);
  }

  const configuredTargetRoot = resolveCargoConfiguredTargetRoot(projectRoot);
  if (configuredTargetRoot) {
    return path.join(
      configuredTargetRoot,
      'tauri-dev',
      resolveTauriDevInstanceName(env),
    );
  }

  return path.join(
    projectRoot,
    'target',
    'tauri-dev',
    resolveTauriDevInstanceName(env)
  );
}
