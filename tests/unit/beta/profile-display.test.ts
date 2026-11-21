import { describe, expect, it } from 'vitest';
import { betaProfileLabels } from '@/beta/profile-display';

describe('Beta profile display labels', () => {
  it('keeps a unique display name concise', () => {
    const labels = betaProfileLabels([{ profile_id: 'profile-a', display_name: '个人档案' }]);

    expect(labels.get('profile-a')).toEqual({
      displayName: '个人档案',
      identity: null,
      text: '个人档案',
    });
  });

  it('adds a stable short identity when display names collide', () => {
    const labels = betaProfileLabels([
      { profile_id: '12345678-a', display_name: '同名档案' },
      { profile_id: '12345678-b', display_name: '同名档案' },
    ]);

    expect(labels.get('12345678-a')?.text).toBe('12345678-a · 同名档案');
    expect(labels.get('12345678-b')?.text).toBe('12345678-b · 同名档案');
  });

  it('extends the identity prefix until every colliding profile is distinct', () => {
    const labels = betaProfileLabels([
      { profile_id: '123456789-a', display_name: '同名档案' },
      { profile_id: '123456789-b', display_name: '同名档案' },
    ]);

    expect(labels.get('123456789-a')?.identity).toBe('123456789-a');
    expect(labels.get('123456789-b')?.identity).toBe('123456789-b');
  });
});
