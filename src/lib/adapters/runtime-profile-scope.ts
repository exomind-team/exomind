import { getCurrentProfileOrLegacyId } from '@/lib/profile/profile-storage';

/**
 * Runtime profile scope（运行时档案作用域）
 * 统一把当前档案键透传为 `user_id` query，保持 RT / 本地存储作用域一致。
 */
export function appendRuntimeProfileScope(path: string): string {
  const profileId = getCurrentProfileOrLegacyId();
  console.log(`[runtime-profile-scope] path=${path} user_id=${profileId}`);
  const url = new URL(path, 'http://runtime.local');
  url.searchParams.set('user_id', profileId);
  return `${url.pathname}${url.search}`;
}
