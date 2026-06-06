import { getCurrentProfileOrLegacyId } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';

/**
 * Runtime profile scope（运行时档案作用域）
 * 统一把当前档案键透传为 `user_id` query，保持 RT / 本地存储作用域一致。
 *
 * 优先从 sync store 的 activeProfileId 获取（主窗口状态），
 * 其次从 localStorage 的 profile session 获取。
 * 严禁兜底：如果都无法获取，直接报错。
 */
export function appendRuntimeProfileScope(path: string): string {
  // 优先从 sync store 获取（主窗口状态，最可靠）
  let profileId: string | null = null;
  try {
    const syncState = useSyncStore.getState();
    profileId = syncState.activeProfileId;
  } catch {
    // sync store 可能还没初始化
  }

  // fallback 到 localStorage profile session
  if (!profileId) {
    profileId = getCurrentProfileOrLegacyId();
  }

  if (!profileId) {
    throw new Error(
      `[runtime-profile-scope] 无法获取当前档案：sync store activeProfileId="${profileId}"。` +
      `请确保主窗口已正确设置档案。`
    );
  }
  const url = new URL(path, 'http://runtime.local');
  url.searchParams.set('user_id', profileId);
  return `${url.pathname}${url.search}`;
}
