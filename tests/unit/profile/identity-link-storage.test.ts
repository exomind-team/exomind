import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('identity-link-storage（远端身份绑定存储）', () => {
  beforeEach(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('creates an identity link and stores remote secret separately（创建远端身份绑定并分离保存远端机密）', async () => {
    const module = await import('@/lib/profile/identity-link-storage');

    const link = module.createIdentityLink({
      profileId: 'profile-hailay',
      providerId: 'self-hosted-sync',
      remoteIdentityId: 'rid-hailay',
      remoteIdentityKey: 'space-hailay',
      displayName: 'Hailay Cloud',
      authType: 'basic',
      authUsername: 'hailay-cloud',
      authSecret: 'remote-secret',
    });

    expect(link.profileId).toBe('profile-hailay');
    expect(link.providerId).toBe('self-hosted-sync');
    expect(link.remoteIdentityKey).toBe('space-hailay');
    expect(link.status).toBe('linked');

    const links = module.listIdentityLinks('profile-hailay');
    expect(links).toHaveLength(1);

    const storedSecret = module.getIdentityLinkSecret(link.linkId);
    expect(storedSecret?.authUsername).toBe('hailay-cloud');
    expect(storedSecret?.authSecret).toBe('remote-secret');
  });

  it('revokes identity link without deleting local profile state（撤销远端绑定但不影响本地档案状态）', async () => {
    const module = await import('@/lib/profile/identity-link-storage');

    const link = module.createIdentityLink({
      profileId: 'profile-hailay',
      providerId: 'self-hosted-sync',
      remoteIdentityId: 'rid-hailay',
      remoteIdentityKey: 'space-hailay',
      authType: 'token',
      authSecret: 'token-123',
    });

    module.revokeIdentityLink(link.linkId);

    const revoked = module.getIdentityLink(link.linkId);
    expect(revoked?.status).toBe('revoked');
    expect(module.getIdentityLinkSecret(link.linkId)).toBeNull();
  });

  it('upserts same provider link and prefers latest linked identity（同 provider 重绑时应取最新绑定）', async () => {
    const module = await import('@/lib/profile/identity-link-storage');

    const first = module.createIdentityLink({
      profileId: 'profile-hailay',
      providerId: 'self-hosted-sync',
      remoteIdentityId: 'rid-old',
      remoteIdentityKey: 'space-old',
      authType: 'basic',
      authUsername: 'old-user',
      authSecret: 'old-secret',
    });

    const second = module.createIdentityLink({
      profileId: 'profile-hailay',
      providerId: 'self-hosted-sync',
      remoteIdentityId: 'rid-new',
      remoteIdentityKey: 'space-new',
      authType: 'basic',
      authUsername: 'new-user',
      authSecret: 'new-secret',
    });

    expect(second.linkId).toBe(first.linkId);
    expect(module.listIdentityLinks('profile-hailay')).toHaveLength(1);
    expect(module.getPreferredIdentityLink('profile-hailay')?.remoteIdentityKey).toBe('space-new');
    expect(module.getIdentityLinkSecret(second.linkId)?.authSecret).toBe('new-secret');
  });
});
