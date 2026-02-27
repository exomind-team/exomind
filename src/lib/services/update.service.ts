/**
 * 更新检查服务
 *
 * 负责与 ExoMind 更新 API 通信，检测新版本并触发下载。
 * 支持 release / preview 双通道，Windows / Android 双平台。
 */

const API_BASE = 'https://exo-mind.ai';

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
// API calls
// ---------------------------------------------------------------------------

/**
 * 调用后端 /api/update/check 接口检查是否有新版本。
 */
export async function checkForUpdate(params: UpdateCheckParams): Promise<UpdateInfo> {
  const url = new URL('/api/update/check', API_BASE);
  url.searchParams.set('channel', params.channel);
  url.searchParams.set('platform', params.platform);
  url.searchParams.set('current_version', params.currentVersion);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Update check failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return {
    hasUpdate: data.has_update,
    currentVersion: data.current_version,
    latestVersion: data.latest_version,
    downloadUrl: data.download_url,
    size: data.size,
    sha256: data.sha256,
    publishedAt: data.published_at,
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
  const data = await res.json();
  // API 可能返回 { versions: [...] } 或直接返回数组
  const list = Array.isArray(data) ? data : (data.versions ?? [data.latest].filter(Boolean));
  return list.map((v: Record<string, unknown>) => ({
    version: v.version as string,
    publishedAt: (v.published_at ?? v.publishedAt) as string,
  }));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * 触发下载更新。
 * Windows / Android 均通过 Tauri opener 插件在系统浏览器中打开下载链接。
 * 非 Tauri 环境回退到 window.open。
 */
export async function downloadUpdate(downloadUrl: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(downloadUrl);
    return;
  } catch {
    // 非 Tauri 环境
  }
  window.open(downloadUrl, '_blank');
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

let timerId: ReturnType<typeof setInterval> | null = null;

/**
 * 启动自动检查定时器。
 * @param interval  检查频率
 * @param callback  每次触发时执行的回调（通常是 store.checkForUpdate）
 */
export function startAutoCheck(interval: CheckInterval, callback: () => void): void {
  stopAutoCheck();
  const ms = INTERVAL_MS[interval];
  if (ms <= 0) return; // manual 模式不启动定时器
  timerId = setInterval(callback, ms);
}

/**
 * 停止自动检查定时器。
 */
export function stopAutoCheck(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}
