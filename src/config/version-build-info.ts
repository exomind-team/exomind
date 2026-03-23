export type VersionEnvMap = Record<string, string | undefined>;

export type VersionBuildInfo = {
  appVersion: string;
  buildHash: string;
};

const SHORT_HASH_LENGTH = 7; // git short hash（短哈希）长度
const BUILD_HASH_PATTERN = /^[0-9a-fA-F]{7,40}$/; // 允许 7~40 位十六进制哈希

export function resolveAppVersion(envMap: VersionEnvMap, baseVersion: string): string {
  const appVersion = envMap.VITE_APP_VERSION?.trim();
  if (appVersion) {
    return appVersion;
  }
  return baseVersion;
}

export function resolveBuildHash(rawHash?: string): string {
  const normalizedHash = rawHash?.trim();
  if (!normalizedHash || !BUILD_HASH_PATTERN.test(normalizedHash)) {
    return 'dev'; // dev 表示本地开发态（development fallback）
  }
  return normalizedHash.toLowerCase().slice(0, SHORT_HASH_LENGTH);
}

export function resolveVersionBuildInfo(envMap: VersionEnvMap, baseVersion: string): VersionBuildInfo {
  return {
    appVersion: resolveAppVersion(envMap, baseVersion),
    buildHash: resolveBuildHash(envMap.VITE_BUILD_HASH),
  };
}
