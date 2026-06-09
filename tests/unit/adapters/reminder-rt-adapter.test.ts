import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderRtAdapter } from '@/lib/adapters/reminder-rt-adapter';
import { createLocalProfile, setProfileSession } from '@/lib/profile/profile-storage';

function activateReminderProfileScope(): string {
  const profile = createLocalProfile({
    slug: 'reminder-user',
    displayName: 'Reminder User',
  });
  setProfileSession({
    version: 1,
    activeProfileId: profile.profileId,
    unlockedProfileIds: [profile.profileId],
  });
  return profile.profileId;
}

describe('ReminderRtAdapter（RT 提醒适配器）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('maps runtime reminder payload to frontend Reminder（把运行时提醒载荷映射为前端 Reminder）', async () => {
    const profileId = activateReminderProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'reminder-1',
          title: 'RT Reminder',
          content: 'remember to ship',
          due_at: 1_700_000_100_000,
          status: 'pending',
          created_at: 1_700_000_000_000,
          updated_at: 1_700_000_050_000,
          completed_at: null,
        },
      ]),
    }));

    const adapter = new ReminderRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const reminders = await adapter.listReminders();

    expect(reminders).toEqual([
      {
        id: 'reminder-1',
        title: 'RT Reminder',
        content: 'remember to ship',
        dueAt: 1_700_000_100_000,
        status: 'pending',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_050_000,
      },
    ]);

    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/reminders');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('serializes create payload to runtime snake_case contract（创建提醒时应写入运行时 snake_case 协议）', async () => {
    const profileId = activateReminderProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'reminder-2',
        title: 'New Reminder',
        content: 'created via rt',
        due_at: 1_700_000_200_000,
        status: 'pending',
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
        completed_at: null,
      }),
    }));

    const adapter = new ReminderRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await adapter.createReminder({
      title: 'New Reminder',
      content: 'created via rt',
      dueAt: 1_700_000_200_000,
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/reminders');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit?.method).toBe('POST');
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      title: 'New Reminder',
      content: 'created via rt',
      due_at: 1_700_000_200_000,
    });
  });
});
