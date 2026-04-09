import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReleaseBumpKind = 'major' | 'minor' | 'patch';

export interface CanonicalVersionTexts {
  packageJson: string;
  cargoToml: string;
  tauriConfig: string;
}

export interface CanonicalVersionPaths {
  packageJson: string;
  cargoToml: string;
  tauriConfig: string;
}

export interface ReleaseVersionPlanOptions {
  localVersion: string;
  remoteTags: string[];
  bump: ReleaseBumpKind;
  explicitVersion?: string;
}

export interface ReleaseVersionPlan {
  localVersion: string;
  remoteLatestTag: string | null;
  remoteLatestVersion: string | null;
  baseVersion: string;
  nextVersion: string;
  nextTag: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');
const CANONICAL_VERSION_RE = /^\d+\.\d+\.\d+$/;
const CANONICAL_TAG_RE = /^v\d+\.\d+\.\d+$/;

export const VERSION_FILE_RELATIVE_PATHS = {
  packageJson: 'package.json',
  cargoToml: 'src-tauri/Cargo.toml',
  tauriConfig: 'src-tauri/tauri.conf.json',
} satisfies CanonicalVersionPaths;

export function assertCanonicalVersion(version: string): void {
  if (!CANONICAL_VERSION_RE.test(version.trim())) {
    throw new Error(`版本号必须是 0.x.y 形式的纯语义化版本，当前为: ${version}`);
  }
}

export function isCanonicalTag(tag: string): boolean {
  return CANONICAL_TAG_RE.test(tag.trim());
}

export function stripTagPrefix(tagOrVersion: string): string {
  return tagOrVersion.trim().replace(/^v/, '');
}

export function parseCanonicalVersion(
  version: string,
): [number, number, number] | null {
  const match = stripTagPrefix(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return [
    Number.parseInt(match[1] ?? '0', 10),
    Number.parseInt(match[2] ?? '0', 10),
    Number.parseInt(match[3] ?? '0', 10),
  ];
}

export function compareCanonicalVersions(left: string, right: string): number {
  const leftParts = parseCanonicalVersion(left);
  const rightParts = parseCanonicalVersion(right);

  if (!leftParts || !rightParts) {
    return stripTagPrefix(left).localeCompare(stripTagPrefix(right));
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function findLatestCanonicalTag(tags: string[]): string | null {
  const canonicalTags = [...new Set(tags.map((tag) => tag.trim()).filter(isCanonicalTag))];
  canonicalTags.sort((left, right) => compareCanonicalVersions(right, left));
  return canonicalTags[0] ?? null;
}

export function bumpCanonicalVersion(
  version: string,
  bump: ReleaseBumpKind,
): string {
  const parts = parseCanonicalVersion(version);
  if (!parts) {
    throw new Error(`无法 bump 非 canonical 版本号: ${version}`);
  }

  const [major, minor, patch] = parts;
  if (bump === 'major') {
    return `${major + 1}.0.0`;
  }
  if (bump === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function resolveReleaseVersionPlan(
  options: ReleaseVersionPlanOptions,
): ReleaseVersionPlan {
  assertCanonicalVersion(options.localVersion);

  const remoteLatestTag = findLatestCanonicalTag(options.remoteTags);
  const remoteLatestVersion = remoteLatestTag ? stripTagPrefix(remoteLatestTag) : null;
  if (remoteLatestVersion && options.localVersion !== remoteLatestVersion) {
    throw new Error(
      `本地版本 ${options.localVersion} 与远端最新版本 ${remoteLatestVersion} 不一致，请先同步到远端最新后再执行自动 bump。`,
    );
  }

  const baseVersion = remoteLatestVersion ?? options.localVersion;

  const nextVersion = options.explicitVersion
    ? options.explicitVersion.trim()
    : bumpCanonicalVersion(baseVersion, options.bump);

  assertCanonicalVersion(nextVersion);

  if (compareCanonicalVersions(nextVersion, baseVersion) <= 0) {
    throw new Error(
      `下一版本必须大于基线版本: next=${nextVersion}, base=${baseVersion}`,
    );
  }

  return {
    localVersion: options.localVersion,
    remoteLatestTag,
    remoteLatestVersion,
    baseVersion,
    nextVersion,
    nextTag: `v${nextVersion}`,
  };
}

export function resolveVersionFilePaths(
  projectRoot = DEFAULT_PROJECT_ROOT,
): CanonicalVersionPaths {
  return {
    packageJson: resolve(projectRoot, VERSION_FILE_RELATIVE_PATHS.packageJson),
    cargoToml: resolve(projectRoot, VERSION_FILE_RELATIVE_PATHS.cargoToml),
    tauriConfig: resolve(projectRoot, VERSION_FILE_RELATIVE_PATHS.tauriConfig),
  };
}

export function readPackageVersion(text: string): string {
  const parsed = JSON.parse(text);
  return String(parsed.version ?? '').trim();
}

export function readCargoVersion(text: string): string {
  const match = text.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  return match?.[1]?.trim() ?? '';
}

export function readTauriVersion(text: string): string {
  const parsed = JSON.parse(text);
  return String(parsed.version ?? '').trim();
}

export function resolveCanonicalVersionFromTexts(
  texts: CanonicalVersionTexts,
): string {
  const versions = {
    packageJson: readPackageVersion(texts.packageJson),
    cargoToml: readCargoVersion(texts.cargoToml),
    tauriConfig: readTauriVersion(texts.tauriConfig),
  };

  const uniqueVersions = [...new Set(Object.values(versions).filter(Boolean))];
  if (uniqueVersions.length !== 1) {
    throw new Error(
      `版本号未对齐: package.json=${versions.packageJson}, Cargo.toml=${versions.cargoToml}, tauri.conf.json=${versions.tauriConfig}`,
    );
  }

  const version = uniqueVersions[0] ?? '';
  assertCanonicalVersion(version);
  return version;
}

export function readCanonicalVersion(projectRoot = DEFAULT_PROJECT_ROOT): string {
  const paths = resolveVersionFilePaths(projectRoot);
  return resolveCanonicalVersionFromTexts({
    packageJson: readFileSync(paths.packageJson, 'utf-8'),
    cargoToml: readFileSync(paths.cargoToml, 'utf-8'),
    tauriConfig: readFileSync(paths.tauriConfig, 'utf-8'),
  });
}

export function updatePackageJsonVersionText(
  text: string,
  version: string,
): string {
  assertCanonicalVersion(version);
  const parsed = JSON.parse(text);
  parsed.version = version;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function updateCargoVersionText(text: string, version: string): string {
  assertCanonicalVersion(version);
  const updated = text.replace(
    /^\s*version\s*=\s*"([^"]+)"\s*$/m,
    `version = "${version}"`,
  );

  if (updated === text) {
    throw new Error('未找到 src-tauri/Cargo.toml 顶层 package.version');
  }

  return updated;
}

export function updateTauriConfigVersionText(
  text: string,
  version: string,
): string {
  assertCanonicalVersion(version);
  const parsed = JSON.parse(text);
  parsed.version = version;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function applyCanonicalVersionToTexts(
  texts: CanonicalVersionTexts,
  version: string,
): CanonicalVersionTexts {
  return {
    packageJson: updatePackageJsonVersionText(texts.packageJson, version),
    cargoToml: updateCargoVersionText(texts.cargoToml, version),
    tauriConfig: updateTauriConfigVersionText(texts.tauriConfig, version),
  };
}

export async function writeCanonicalVersion(
  version: string,
  projectRoot = DEFAULT_PROJECT_ROOT,
): Promise<CanonicalVersionPaths> {
  const paths = resolveVersionFilePaths(projectRoot);
  const updatedTexts = applyCanonicalVersionToTexts(
    {
      packageJson: readFileSync(paths.packageJson, 'utf-8'),
      cargoToml: readFileSync(paths.cargoToml, 'utf-8'),
      tauriConfig: readFileSync(paths.tauriConfig, 'utf-8'),
    },
    version,
  );

  await writeFile(paths.packageJson, updatedTexts.packageJson, 'utf-8');
  await writeFile(paths.cargoToml, updatedTexts.cargoToml, 'utf-8');
  await writeFile(paths.tauriConfig, updatedTexts.tauriConfig, 'utf-8');

  return paths;
}
