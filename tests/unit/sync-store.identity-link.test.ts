import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasswordWithSalt } from '@/adapters/crypto-adapter';

const mockLocalStorageData: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockLocalStorageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorageData[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorageData[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
  }),
  key: vi.fn((index: number) => Object.keys(mockLocalStorageData)[index] ?? null),
  get length() {
    return Object.keys(mockLocalStorageData).length;
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

let useSyncStore: ReturnType<typeof import('@/ui/stores/sync-store').useSyncStore>;

describe('SyncStore identity link（同步身份绑定）', () => {
  beforeEach(async () => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
    vi.clearAllMocks();

    const module = await import('@/ui/stores/sync-store');
    useSyncStore = module.useSyncStore;
  });

  it('links remote identity after local login（本地登录后手动绑定远端身份）', async () => {
    const localPasswordHash = await hashPasswordWithSalt('password123');
    mockLocalStorageData['exomind:users'] = JSON.stringify([
      {
        username: 'testuser',
        passwordHash: localPasswordHash,
        createdAt: new Date().toISOString(),
      },
    ]);

    const state = useSyncStore.getState() as typeof useSyncStore.getState extends () => infer T ? T & {
      linkRemoteIdentity?: (input: {
        providerId: string;
        remoteIdentityId: string;
        remoteIdentityKey: string;
        authType: 'basic' | 'token' | 'none';
        authUsername?: string;
        authSecret?: string;
      }) => Promise<void>;
    } : never;

    await state.login('testuser', 'password123');
    await state.linkRemoteIdentity?.({
      providerId: 'self-hosted-sync',
      remoteIdentityId: 'rid-testuser',
      remoteIdentityKey: 'space-testuser',
      authType: 'basic',
      authUsername: 'cloud-testuser',
      authSecret: 'remote-secret',
    });

    const nextState = useSyncStore.getState();
    expect(nextState.isLoggedIn).toBe(true);
    expect(nextState.currentUser).toBe('testuser');
    expect(nextState.credentials).toBeTruthy();
    expect((nextState.credentials as any).remoteIdentityKey).toBe('space-testuser');
    expect((nextState.credentials as any).authUsername).toBe('cloud-testuser');
    expect((nextState.credentials as any).authSecret).toBe('remote-secret');
    expect((nextState.credentials as any).passwordHash).not.toBe(localPasswordHash);
  });

  it('unlinks remote identity and keeps local profile unlocked（解绑远端身份后保持本地档案可用）', async () => {
    const localPasswordHash = await hashPasswordWithSalt('password123');
    mockLocalStorageData['exomind:users'] = JSON.stringify([
      {
        username: 'testuser',
        passwordHash: localPasswordHash,
        createdAt: new Date().toISOString(),
      },
    ]);

    const state = useSyncStore.getState() as typeof useSyncStore.getState extends () => infer T ? T & {
      linkRemoteIdentity?: (input: {
        providerId: string;
        remoteIdentityId: string;
        remoteIdentityKey: string;
        authType: 'basic' | 'token' | 'none';
        authUsername?: string;
        authSecret?: string;
      }) => Promise<void>;
      unlinkRemoteIdentity?: () => Promise<void>;
    } : never;

    await state.login('testuser', 'password123');
    await state.linkRemoteIdentity?.({
      providerId: 'self-hosted-sync',
      remoteIdentityId: 'rid-testuser',
      remoteIdentityKey: 'space-testuser',
      authType: 'token',
      authSecret: 'token-123',
    });

    expect(useSyncStore.getState().credentials).toBeTruthy();

    await state.unlinkRemoteIdentity?.();

    const nextState = useSyncStore.getState();
    expect(nextState.isLoggedIn).toBe(true);
    expect(nextState.currentUser).toBe('testuser');
    expect(nextState.activeProfileId).toBeTruthy();
    expect(nextState.credentials).toBeNull();
  });
});
