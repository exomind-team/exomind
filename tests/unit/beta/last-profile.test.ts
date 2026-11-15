import { describe, expect, it } from 'vitest';
import { rememberLastBetaProfile, restoreLastBetaProfile, type BetaProfilePreferenceStorage } from '@/beta/last-profile';

const list = [{ profile_id: 'P' }, { profile_id: 'Q' }];
function preferences() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }
describe('last Beta profile is a device-scoped, noncritical preference', () => {
  it('restores only an ID still present in this device list, with a safe first/empty fallback', () => {
    const storage = preferences(); expect(restoreLastBetaProfile('device-a', list, storage)).toBe('P');
    expect(rememberLastBetaProfile('device-a', 'Q', list, storage)).toBe(true);
    expect(restoreLastBetaProfile('device-a', list, storage)).toBe('Q');
    expect(restoreLastBetaProfile('device-b', list, storage)).toBe('P');
    expect(restoreLastBetaProfile('device-a', [{ profile_id: 'P' }], storage)).toBe('P');
    expect(restoreLastBetaProfile('device-a', [], storage)).toBe('');
    expect(rememberLastBetaProfile('device-a', 'absent', list, storage)).toBe(false);
    expect(restoreLastBetaProfile('device-a', list, storage)).toBe('Q');
  });
  it('does not collide encoded device keys or accept invalid identity values', () => {
    const storage = preferences(); rememberLastBetaProfile('device:a', 'Q', list, storage); rememberLastBetaProfile('device%3Aa', 'P', list, storage);
    expect(restoreLastBetaProfile('device:a', list, storage)).toBe('Q'); expect(restoreLastBetaProfile('device%3Aa', list, storage)).toBe('P');
    expect(rememberLastBetaProfile('', 'Q', list, storage)).toBe(false); expect(rememberLastBetaProfile('bad\nidentity', 'Q', list, storage)).toBe(false);
    for (const key of storage.values.keys()) storage.values.set(key, 'corrupt\nidentity');
    expect(restoreLastBetaProfile('device:a', list, storage)).toBe('P');
  });
  it('treats denied/quota-limited storage as preference loss without throwing a service failure', () => {
    const denied: BetaProfilePreferenceStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(restoreLastBetaProfile('device-a', list, denied)).toBe('P'); expect(rememberLastBetaProfile('device-a', 'Q', list, denied)).toBe(false);
    expect(restoreLastBetaProfile('device-a', list, null)).toBe('P'); expect(rememberLastBetaProfile('device-a', 'Q', list, null)).toBe(false);
  });
});
