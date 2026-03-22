import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_RUNTIME_STATUS_STORAGE_KEY } from '@/config/runtime-target';
import { EventLogRtAdapter } from '@/lib/adapters/eventlog-rt-adapter';
import { createLocalProfile, setProfileSession } from '@/lib/profile/profile-storage';

function activateProfileScope(): string {
  const profile = createLocalProfile({
    slug: 'hailay',
    displayName: 'Hailay',
  });
  setProfileSession({
    version: 1,
    activeProfileId: profile.profileId,
    unlockedProfileIds: [profile.profileId],
  });
  return profile.profileId;
}

describe('EventLogRtAdapter（RT 事件日志适配器）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('maps runtime event payload to frontend EventData', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'event-1',
          timestamp: 1700000000000,
          content: 'hello from runtime',
          tags: ['note'],
          metadata: {
            source: {
              deviceId: 'dev-1',
              deviceName: 'Desktop',
              platform: 'windows',
              app: 'ExoMind',
            },
          },
        },
      ]),
    }));

    const adapter = new EventLogRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const events = await adapter.listEvents();

    expect(events).toEqual([
      {
        id: 'event-1',
        timestamp: 1700000000000,
        content: 'hello from runtime',
        tags: ['note'],
        metadata: {
          source: {
            deviceId: 'dev-1',
            deviceName: 'Desktop',
            platform: 'windows',
            app: 'ExoMind',
          },
        },
      },
    ]);
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/eventlog');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('serializes frontend EventData to runtime append payload', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'rt-event-2',
        timestamp: 1700000001000,
        content: 'append me',
        tags: ['voice', 'note'],
        metadata: {
          source: {
            deviceId: 'dev-2',
            deviceName: 'Phone',
            platform: 'android',
            app: 'ExoMind',
          },
        },
      }),
    }));

    const adapter = new EventLogRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const appended = await adapter.appendEvent({
      id: 'event-2',
      timestamp: 1700000001000,
      content: 'append me',
      tags: ['voice', 'note'],
      metadata: {
        source: {
          deviceId: 'dev-2',
          deviceName: 'Phone',
          platform: 'android',
          app: 'ExoMind',
        },
      },
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/eventlog');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit?.method).toBe('POST');
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      timestamp: 1700000001000,
      content: 'append me',
      tags: ['voice', 'note'],
      metadata: {
        source: {
          deviceId: 'dev-2',
          deviceName: 'Phone',
          platform: 'android',
          app: 'ExoMind',
        },
      },
    });
    expect(appended.id).toBe('rt-event-2');
  });

  it('sends embedded runtime auth token when cached status has authSecret（内嵌 RT 鉴权密钥应透传到 EventLog 请求）', async () => {
    activateProfileScope();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    window.localStorage.setItem(
      EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
      JSON.stringify({
        host: '127.0.0.1',
        port: 9124,
        authSecret: 'embedded-secret',
      }),
    );

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'rt-event-auth-1',
        timestamp: 1700000002000,
        content: 'auth protected append',
        tags: ['note'],
      }),
    }));

    const adapter = new EventLogRtAdapter({ fetchImpl });

    await adapter.appendEvent({
      id: 'event-auth-1',
      timestamp: 1700000002000,
      content: 'auth protected append',
      tags: ['note'],
    });

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer embedded-secret');
  });
});
