/**
 * 更新检查服务
 *
 * 负责从 GitHub Pages 静态元数据读取最新版本信息，
 * 下载地址直接指向 GitHub Release assets。
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

const DEFAULT_UPDATE_BASE_URL = 'https://exomind-team.github.io/exomind/';

function normalizeApiBase(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return DEFAULT_UPDATE_BASE_URL;
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

const API_BASE = normalizeApiBase(import.meta.env.VITE_UPDATE_BASE_URL);

export type UpdateChannel = 'release' | 'preview';
export type CheckInterval = 'hourly' | '6h' | 'daily' | 'manual';

export interface UpdateCheckParams {
  channel: UpdateChannel;
  platform: string;
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

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface ReleaseMetadata {
  version: string;
  tag: string;
  published_at: string;
  release_url: string;
  assets: Record<string, ReleaseAsset>;
}

export interface ReleaseVersionsIndex {
  channel: UpdateChannel;
  generated_at: string;
  latest: ReleaseMetadata | null;
  versions: ReleaseMetadata[];
}

export interface VersionInfo {
  version: string;
  publishedAt: string;
}

export function getPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android-arm64';
  if (ua.includes('win')) return 'windows-x64';
  if (ua.includes('mac')) return 'macos-aarch64';
  if (ua.includes('linux')) return 'linux-x64';
  return 'unknown';
}

export async function getCurrentVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    // 非 Tauri 环境
  }

  return import.meta.env.VITE_APP_VERSION ?? '0.0.0';
}

function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.replace(/^v/, '').split('.');
  return [
    Number.parseInt(major ?? '0', 10) || 0,
    Number.parseInt(minor ?? '0', 10) || 0,
    Number.parseInt(patch ?? '0', 10) || 0,
  ];
}

export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

const PLATFORM_ASSET_KEY: Record<string, string> = {
  'windows-x64': 'windows-x64-setup',
  'android-arm64': 'android-arm64',
  'macos-aarch64': 'macos-aarch64',
  'macos-x64': 'macos-x64',
  'linux-x64': 'linux-x64-appimage',
};

function getAssetKey(platform: string): string {
  return PLATFORM_ASSET_KEY[platform] ?? platform;
}

function resolveUpdateUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl.replace(/^\/+/, ''), API_BASE).toString();
}

function buildChannelUrl(channel: UpdateChannel, fileName: 'latest.json' | 'versions.json'): string {
  return resolveUpdateUrl(`releases/${channel}/${fileName}`);
}

export async function checkForUpdate(params: UpdateCheckParams): Promise<UpdateInfo> {
  const response = await fetch(buildChannelUrl(params.channel, 'latest.json'));
  if (!response.ok) {
    throw new Error(`Update check failed: ${response.status} ${response.statusText}`);
  }

  const latest = (await response.json()) as ReleaseMetadata | null;
  if (!latest) {
    return {
      hasUpdate: false,
      currentVersion: params.currentVersion,
      latestVersion: params.currentVersion,
    };
  }

  const latestVersion = latest.version;
  const hasUpdate = compareVersions(latestVersion, params.currentVersion) > 0;
  const asset = latest.assets[getAssetKey(params.platform)];

  return {
    hasUpdate,
    currentVersion: params.currentVersion,
    latestVersion,
    downloadUrl: asset?.url,
    size: asset?.size,
    sha256: asset?.sha256,
    publishedAt: latest.published_at,
  };
}

export async function getVersions(channel: UpdateChannel): Promise<VersionInfo[]> {
  const response = await fetch(buildChannelUrl(channel, 'versions.json'));
  if (!response.ok) {
    throw new Error(`Get versions failed: ${response.status} ${response.statusText}`);
  }

  const index = (await response.json()) as ReleaseVersionsIndex;
  return (index.versions ?? []).map((version) => ({
    version: version.version,
    publishedAt: version.published_at,
  }));
}

export async function downloadUpdate(downloadUrl: string, expectedSha256?: string): Promise<void> {
  const resolvedUrl = resolveUpdateUrl(downloadUrl);

  if (expectedSha256) {
    const normalizedExpected = expectedSha256.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
      throw new Error('Invalid SHA-256 format');
    }

    const preflightResponse = await fetch(resolvedUrl);
    if (!preflightResponse.ok) {
      throw new Error(
        `Download integrity preflight failed: ${preflightResponse.status} ${preflightResponse.statusText}`,
      );
    }

    const bytes = new Uint8Array(await preflightResponse.arrayBuffer());
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

export function createAutoCheckController(): AutoCheckController {
  let timerId: ReturnType<typeof setInterval> | null = null;

  return {
    start(interval, callback) {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }

      const ms = INTERVAL_MS[interval];
      if (ms <= 0) return;

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
