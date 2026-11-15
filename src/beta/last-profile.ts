interface ProfileOption { profile_id: string }
export interface BetaProfilePreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const PREFIX = 'exomind:beta:last-profile:';
function identity(value: string): boolean { return !!value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function storage(): BetaProfilePreferenceStorage | null { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } }

/** A noncritical UI preference only. The authoritative local profile list is
 * always checked; a saved ID never creates, imports, merges or opens a scope
 * absent from that device. Storage failure cannot become a service error. */
export function restoreLastBetaProfile(deviceId: string, profiles: readonly ProfileOption[], preferences: BetaProfilePreferenceStorage | null = storage()): string {
  const fallback = profiles[0]?.profile_id ?? '';
  if (!identity(deviceId)) return fallback;
  try {
    const saved = preferences?.getItem(`${PREFIX}${encodeURIComponent(deviceId)}`);
    return saved && identity(saved) && profiles.some(profile => profile.profile_id === saved) ? saved : fallback;
  } catch { return fallback; }
}
export function rememberLastBetaProfile(deviceId: string, profileId: string, profiles: readonly ProfileOption[], preferences: BetaProfilePreferenceStorage | null = storage()): boolean {
  if (!preferences || !identity(deviceId) || !identity(profileId) || !profiles.some(profile => profile.profile_id === profileId)) return false;
  try { preferences.setItem(`${PREFIX}${encodeURIComponent(deviceId)}`, profileId); return true; }
  catch { return false; }
}
