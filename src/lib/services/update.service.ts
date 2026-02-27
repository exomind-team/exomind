/**
 * 更新检查服务
 *
 * 负责与 ExoMind 更新 API 通信，检测新版本并触发下载。
 * 支持 release / preview 双通道，Windows / Android 双平台。
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

const API_BASE = import.meta.env.VITE_UPDATE_BASE_URL || 'https://exo-mind.ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateChannel = 'release' | 'preview';
export type CheckInterval = 'hourly' | '6h' | 'daily' | 'manual';

export interface UpdateCheckParams {
  channel: UpdateChannel;
  platform: string; // e.g. 'windows-x64' | 'android-arm64'
  currentVersion: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl?: string;
  size?: number;
  sha256?: string;
  publishedAt?: string;
}

export interface VersionAsset {
  url: string;
  size: number;
  sha256: string;
}

export interface VersionsApiResponse {
  channel: string;
  latest: {
    version: string;
    tag: string;
    published_at: string;
    assets: Record<string, VersionAsset>;
  } | null;
  versions: Array<{
    version: string;
    tag: string;
    published_at: string;
    version_dir: string;
  }>;
  retention: number;
}

export interface VersionInfo {
  version: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * 检测当前运行平台，通过 userAgent 推断。
 */
export function getPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android-arm64';
  if (ua.includes('win')) return 'windows-x64';
  if (ua.includes('mac')) return 'macos-x64';
  if (ua.includes('linux')) return 'linux-x64';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * 获取当前应用版本号。
 * 优先通过 Tauri `getVersion()` 获取，回退到 Vite 注入的环境变量。
 */
export async function getCurrentVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    // 非 Tauri 环境
  }
  return import.meta.env.VITE_APP_VERSION ?? '0.0.0';
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * 将版本字符串解析为可比较的数组。
 * 支持格式：'0.3.4', '0.3.4-build.20260227T1430', '0.3.4-beta.1'
 * 返回 [major, minor, patch, prerelease_string]
 */
function parseVersion(v: string): [number, number, number, string] {
  const cleaned = v.replace(/^v/, '');
  const [core, ...rest] = cleaned.split('-');
  const parts = core.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, rest.join('-')];
}

/**
 * 按 `.` 分段比较 prerelease 字符串（遵循 semver 规则）。
 * 纯数字段按数值比较，否则按字典序。
 */
function comparePrerelease(a: string, b: string): number {
  const aParts = a.split('.');
  const bParts = b.split('.');
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    // 段少的一方更小
    if (i >= aParts.length) return -1;
    if (i >= bParts.length) return 1;

    const aIsNum = /^\d+$/.test(aParts[i]);
    const bIsNum = /^\d+$/.test(bParts[i]);

    if (aIsNum && bIsNum) {
      const diff = Number(aParts[i]) - Number(bParts[i]);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    } else {
      if (aParts[i] < bParts[i]) return -1;
      if (aParts[i] > bParts[i]) return 1;
    }
  }
  return 0;
}

/**
 * 比较两个版本号。返回 1 (a > b), -1 (a < b), 0 (a == b)。
 * 有 prerelease 标签的版本低于同版本号的正式版。
 * prerelease 按 `.` 分段比较，数字段用数值比较。
 */
export function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPat, aPre] = parseVersion(a);
  const [bMaj, bMin, bPat, bPre] = parseVersion(b);

  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;

  // 无 prerelease > 有 prerelease（正式版 > 预发布）
  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
  if (aPre === bPre) return 0;
  return comparePrerelease(aPre, bPre);
}

// ---------------------------------------------------------------------------
// Platform asset key mapping
// ---------------------------------------------------------------------------

/**
 * 将 getPlatform() 返回的平台标识映射到 API assets 中的 key。
 */
const PLATFORM_ASSET_KEY: Record<string, string> = {
  'windows-x64': 'windows-x64-setup',
  'android-arm64': 'android-arm64',
  'macos-x64': 'macos-x64',
  'linux-x64': 'linux-x64',
};

function getAssetKey(platform: string): string {
  return PLATFORM_ASSET_KEY[platform] ?? platform;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * 通过 /api/versions 接口获取最新版本信息，在客户端做版本比较。
 */
export async function checkForUpdate(params: UpdateCheckParams): Promise<UpdateInfo> {
  const url = new URL('/api/versions', API_BASE);
  url.searchParams.set('channel', params.channel);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Update check failed: ${res.status} ${res.statusText}`);
  }
  const data: VersionsApiResponse = await res.json();

  if (!data.latest) {
    return {
      hasUpdate: false,
      currentVersion: params.currentVersion,
      latestVersion: params.currentVersion,
    };
  }

  const latestVersion = data.latest.version;
  const hasUpdate = compareVersions(latestVersion, params.currentVersion) > 0;

  const assetKey = getAssetKey(params.platform);
  const asset = data.latest.assets[assetKey];

  return {
    hasUpdate,
    currentVersion: params.currentVersion,
    latestVersion,
    downloadUrl: asset?.url,
    size: asset?.size,
    sha256: asset?.sha256,
    publishedAt: data.latest.published_at,
  };
}

/**
 * 获取指定通道的版本列表。
 */
export async function getVersions(channel: UpdateChannel): Promise<VersionInfo[]> {
  const url = new URL('/api/versions', API_BASE);
  url.searchParams.set('channel', channel);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Get versions failed: ${res.status} ${res.statusText}`);
  }
  const data: VersionsApiResponse = await res.json();
  const list = data.versions?.length ? data.versions : (data.latest ? [data.latest] : []);
  return list.map((v) => ({
    version: v.version,
    publishedAt: v.published_at,
  }));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * 触发下载更新。
 * 有 sha256 时先做完整性预检（integrity preflight，完整性预检），再打开下载链接。
 * Windows / Android 优先通过 Tauri opener 在系统浏览器中打开，非 Tauri 环境回退到 window.open。
 */
export async function downloadUpdate(downloadUrl: string, expectedSha256?: string): Promise<void> {
  const resolvedUrl = new URL(downloadUrl, API_BASE).toString();

  if (expectedSha256) {
    const normalizedExpected = expectedSha256.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
      throw new Error('Invalid SHA-256 format');
    }

    const preflightRes = await fetch(resolvedUrl);
    if (!preflightRes.ok) {
      throw new Error(
        `Download integrity preflight failed: ${preflightRes.status} ${preflightRes.statusText}`,
      );
    }

    const bytes = new Uint8Array(await preflightRes.arrayBuffer());
    const actualSha256 = bytesToHex(nobleSha256(bytes));
    if (actualSha256 !== normalizedExpected) {
      throw new Error(`SHA-256 mismatch: expected ${normalizedExpected}, got ${actualSha256}`);
    }
  }

  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(resolvedUrl);
    return;
  } catch {
    // 非 Tauri 环境
  }
  window.open(resolvedUrl, '_blank');
}

// ---------------------------------------------------------------------------
// Auto-check timer
// ---------------------------------------------------------------------------

const INTERVAL_MS: Record<CheckInterval, number> = {
  hourly: 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  manual: 0,
};

export interface AutoCheckController {
  start: (interval: CheckInterval, callback: () => void) => void;
  stop: () => void;
}

/**
 * 创建自动检查控制器（controller，控制器）。
 * 每个 controller 持有独立 timer，避免模块级全局状态引发竞态。
 */
export function createAutoCheckController(): AutoCheckController {
  let timerId: ReturnType<typeof setInterval> | null = null;

  return {
    start(interval, callback) {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }

      const ms = INTERVAL_MS[interval];
      if (ms <= 0) return; // manual 模式不启动定时器

      timerId = setInterval(callback, ms);
    },
    stop() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    },
  };
}
