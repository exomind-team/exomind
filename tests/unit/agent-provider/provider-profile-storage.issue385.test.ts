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

describe('provider-profile-storage issue-385（API Provider 档案存储）', () => {
  beforeEach(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('creates provider profile with meta + secret split（创建档案时分别保存元数据与密钥）', async () => {
    const module = await import('@/lib/agent-provider/provider-profile-storage');

    const profile = module.createProviderProfile({
      name: 'OpenAI GPT-5.4',
      provider: 'openai',
      model: 'gpt-5.4',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-test',
    });

    expect(profile.profileId).toBeTruthy();
    expect(module.listProviderProfiles()).toHaveLength(1);

    const storedMeta = module.getProviderProfileMeta(profile.profileId);
    expect(storedMeta?.name).toBe('OpenAI GPT-5.4');
    expect(storedMeta?.provider).toBe('openai');
    expect(storedMeta?.model).toBe('gpt-5.4');
    expect(storedMeta?.baseUrl).toBe('https://api.openai.com/v1');

    const storedSecret = module.getProviderProfileSecret(profile.profileId);
    expect(storedSecret?.apiKey).toBe('sk-openai-test');
  });

  it('resolves merged provider profile snapshot（可解析合并后的 provider 档案快照）', async () => {
    const module = await import('@/lib/agent-provider/provider-profile-storage');
    const created = module.createProviderProfile({
      name: 'Anthropic Sonnet',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      apiKey: 'sk-ant-test',
    });

    expect(module.resolveProviderProfile(created.profileId)).toEqual({
      profileId: created.profileId,
      name: 'Anthropic Sonnet',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      baseUrl: undefined,
      apiKey: 'sk-ant-test',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      lastUsedAt: undefined,
    });
  });

  it('marks provider profile as recently used（标记最后使用时间）', async () => {
    const module = await import('@/lib/agent-provider/provider-profile-storage');
    const created = module.createProviderProfile({
      name: 'Codex OpenAI',
      provider: 'openai',
      model: 'gpt-5.3-codex',
      apiKey: 'sk-openai-codex',
    });

    expect(module.getProviderProfileMeta(created.profileId)?.lastUsedAt).toBeUndefined();

    const updated = module.markProviderProfileUsed(created.profileId);
    expect(updated?.lastUsedAt).toBeTruthy();
    expect(module.getProviderProfileMeta(created.profileId)?.lastUsedAt).toBe(updated?.lastUsedAt);
  });

  it('updates provider profile model and secret independently（可独立更新模型与密钥）', async () => {
    const module = await import('@/lib/agent-provider/provider-profile-storage');
    const created = module.createProviderProfile({
      name: 'OpenAI Base',
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: 'sk-old',
    });

    const updated = module.updateProviderProfile(created.profileId, {
      model: 'gpt-5.4',
      apiKey: 'sk-new',
      baseUrl: 'https://example-proxy/v1',
    });

    expect(updated?.model).toBe('gpt-5.4');
    expect(updated?.baseUrl).toBe('https://example-proxy/v1');
    expect(module.getProviderProfileSecret(created.profileId)?.apiKey).toBe('sk-new');
  });
});
