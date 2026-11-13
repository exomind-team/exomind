import { invoke, isTauri } from '@tauri-apps/api/core';
import { createUuidV4, ensureCryptoRandomUUID } from '@/lib/utils/uuid';

export function betaUuid(): string {
  if (!globalThis.crypto || (typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues !== 'function')) {
    throw new Error('当前环境无法生成随机身份，请更换支持安全随机数的浏览器');
  }
  return createUuidV4();
}

export function initializeBetaUuid(): void {
  const secure = globalThis.crypto;
  if (!secure || (typeof secure.randomUUID !== 'function' && typeof secure.getRandomValues !== 'function')) {
    throw new Error('当前环境无法生成随机身份，请更换支持安全随机数的浏览器');
  }
  ensureCryptoRandomUUID();
}

/** The legacy display service imports runtime configuration. This entry reads
 * only the existing device preference and the shared native display command. */
export async function applyBetaMobileDisplayPreference(): Promise<void> {
  if (!isTauri() || !/android/i.test(navigator.userAgent)) return;
  const enabled = localStorage.getItem('exomind:mobileFullscreenEnabled') === 'true';
  await invoke('mobile_fullscreen_set', { enabled });
}
