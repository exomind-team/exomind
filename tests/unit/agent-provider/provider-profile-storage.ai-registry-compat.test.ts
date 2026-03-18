import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIRegistrySnapshot } from '@/lib/ai-registry/types';

const localStorageData: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageData[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageData[key];
  }),
  clear: vi.fn(() => {
    Object.keys(localStorageData).forEach((key) => delete localStorageData[key]);
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

function createRegistrySnapshot(): AIRegistrySnapshot {
  return {
    version: 1,
    channels: [
      {
        channelId: 'channel-provider-openai',
        name: 'OpenAI Main',
        vendor: 'openai',
        channelType: 'official',
        apiHost: 'https://api.openai.com/v1',
        authKind: 'api_key',
        enabled: true,
        createdAt: '2026-03-18T08:00:00.000Z',
        updatedAt: '2026-03-18T08:00:00.000Z',
      },
    ],
    models: [
      {
        modelId: 'model-gpt-5',
        canonicalKey: 'gpt-5',
        displayName: 'gpt-5',
        vendor: 'openai',
        modality: 'llm',
        aliases: ['gpt-5'],
        deprecated: false,
      },
    ],
    capabilities: [
      {
        capabilityId: 'capability-llm-chat',
        key: 'llm.chat',
        displayName: 'LLM Chat',
        inputKind: 'text',
        outputKind: 'text',
      },
    ],
    offerings: [
      {
        offeringId: 'offering-provider-openai',
        channelId: 'channel-provider-openai',
        modelId: 'model-gpt-5',
        capabilityId: 'capability-llm-chat',
        enabled: true,
        recommended: false,
      },
    ],
    energySources: [
      {
        energySourceId: 'energy-provider-openai',
        channelId: 'channel-provider-openai',
        accountLabel: 'OpenAI Main',
        credentialRef: 'registry:provider-openai',
        createdAt: '2026-03-18T08:00:00.000Z',
        updatedAt: '2026-03-18T08:00:00.000Z',
      },
    ],
    resolutionRules: [],
    updatedAt: '2026-03-18T08:00:00.000Z',
  };
}

describe('provider-profile-storage ai registry compat（Provider Profile 注册中心兼容层）', () => {
  beforeEach(() => {
    Object.keys(localStorageData).forEach((key) => delete localStorageData[key]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('projects registry llm offerings into provider profiles（将注册中心供给项投影为 provider profile）', async () => {
    const storageModule = await import('@/lib/ai-registry/storage');
    const secretsModule = await import('@/lib/ai-registry/secrets');
    const providerModule = await import('@/lib/agent-provider/provider-profile-storage');

    storageModule.saveAIRegistrySnapshot(createRegistrySnapshot());
    secretsModule.saveAIEnergySecret('energy-provider-openai', {
      apiKey: 'sk-openai-main',
      updatedAt: '2026-03-18T08:00:00.000Z',
    });

    const profiles = providerModule.listProviderProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual(expect.objectContaining({
      name: 'OpenAI Main',
      provider: 'openai',
      model: 'gpt-5',
    }));

    const resolved = providerModule.resolveProviderProfile(profiles[0]!.profileId);
    expect(resolved?.apiKey).toBe('sk-openai-main');
  });

  it('creates provider profile into registry snapshot（创建 provider profile 时写入注册中心）', async () => {
    const providerModule = await import('@/lib/agent-provider/provider-profile-storage');
    const storageModule = await import('@/lib/ai-registry/storage');
    const secretsModule = await import('@/lib/ai-registry/secrets');

    const profile = providerModule.createProviderProfile({
      name: 'Anthropic Sonnet',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-anthropic-sonnet',
    });

    const snapshot = storageModule.getAIRegistrySnapshot();
    expect(snapshot.offerings.some((item) => `registry-${item.offeringId}` === profile.profileId)).toBe(true);

    const resolved = providerModule.resolveProviderProfile(profile.profileId);
    expect(resolved).toEqual(expect.objectContaining({
      name: 'Anthropic Sonnet',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      apiKey: 'sk-anthropic-sonnet',
    }));

    const energySource = snapshot.energySources.find((item) => item.accountLabel === 'Anthropic Sonnet');
    expect(secretsModule.getAIEnergySecret(energySource?.energySourceId ?? '')?.apiKey).toBe('sk-anthropic-sonnet');
  });

  it('keeps legacy profile ids addressable after import（导入后旧 profileId 仍可通过兼容入口访问）', async () => {
    const providerModule = await import('@/lib/agent-provider/provider-profile-storage');

    localStorage.setItem('exomind:agent-provider-profiles:index', JSON.stringify(['openai-main']));
    localStorage.setItem(
      'exomind:agent-provider-profiles:openai-main:meta',
      JSON.stringify({
        profileId: 'openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: 'https://api.openai.com/v1',
        createdAt: '2026-03-18T08:00:00.000Z',
        updatedAt: '2026-03-18T08:00:00.000Z',
      }),
    );
    localStorage.setItem(
      'exomind:agent-provider-profiles:openai-main:secret',
      JSON.stringify({
        profileId: 'openai-main',
        apiKey: 'sk-legacy-openai-main',
        updatedAt: '2026-03-18T08:00:00.000Z',
      }),
    );

    const profiles = providerModule.listProviderProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.profileId).toMatch(/^registry-/);

    expect(providerModule.getProviderProfileMeta('openai-main')).toEqual(
      expect.objectContaining({
        name: 'OpenAI Main',
        model: 'gpt-5',
      }),
    );
    expect(providerModule.getProviderProfileSecret('openai-main')).toEqual(
      expect.objectContaining({
        apiKey: 'sk-legacy-openai-main',
      }),
    );
    expect(providerModule.resolveProviderProfile('openai-main')).toEqual(
      expect.objectContaining({
        name: 'OpenAI Main',
        apiKey: 'sk-legacy-openai-main',
      }),
    );

    const updated = providerModule.updateProviderProfile('openai-main', {
      name: 'OpenAI Main Updated',
      apiKey: 'sk-legacy-openai-updated',
    });
    expect(updated).toEqual(
      expect.objectContaining({
        name: 'OpenAI Main Updated',
      }),
    );

    const marked = providerModule.markProviderProfileUsed('openai-main');
    expect(marked?.lastUsedAt).toBeTruthy();
    expect(providerModule.resolveProviderProfile('openai-main')).toEqual(
      expect.objectContaining({
        name: 'OpenAI Main Updated',
        apiKey: 'sk-legacy-openai-updated',
      }),
    );
  });
});
