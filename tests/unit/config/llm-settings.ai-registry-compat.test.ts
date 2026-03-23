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
        channelId: 'channel-default-chat',
        name: 'Default Chat Channel',
        vendor: 'openai',
        channelType: 'proxy',
        apiHost: 'https://openai-proxy.example/v1',
        authKind: 'api_key',
        enabled: true,
        createdAt: '2026-03-18T08:00:00.000Z',
        updatedAt: '2026-03-18T08:00:00.000Z',
      },
    ],
    models: [
      {
        modelId: 'model-gpt-5-4',
        canonicalKey: 'gpt-5-4',
        displayName: 'gpt-5.4',
        vendor: 'openai',
        modality: 'llm',
        aliases: ['gpt-5.4'],
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
        offeringId: 'offering-default-chat',
        channelId: 'channel-default-chat',
        modelId: 'model-gpt-5-4',
        capabilityId: 'capability-llm-chat',
        enabled: true,
        recommended: true,
      },
    ],
    energySources: [
      {
        energySourceId: 'energy-default-chat',
        channelId: 'channel-default-chat',
        accountLabel: 'Default Chat Channel',
        credentialRef: 'registry:default-chat',
        createdAt: '2026-03-18T08:00:00.000Z',
        updatedAt: '2026-03-18T08:00:00.000Z',
      },
    ],
    resolutionRules: [
      {
        ruleId: 'rule-llm-chat',
        targetKey: 'llm.chat',
        defaultOfferingId: 'offering-default-chat',
        fallbackOfferingIds: [],
      },
    ],
    updatedAt: '2026-03-18T08:00:00.000Z',
  };
}

describe('llm-settings ai registry compat（LLM 设置注册中心兼容层）', () => {
  beforeEach(() => {
    Object.keys(localStorageData).forEach((key) => delete localStorageData[key]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('reads default llm settings from registry snapshot（从注册中心读取默认 llm.chat 设置）', async () => {
    const storageModule = await import('@/lib/ai-registry/storage');
    const secretsModule = await import('@/lib/ai-registry/secrets');
    const llmSettingsModule = await import('@/config/llm-settings');

    storageModule.saveAIRegistrySnapshot(createRegistrySnapshot());
    secretsModule.saveAIEnergySecret('energy-default-chat', {
      apiKey: 'sk-registry-default',
      updatedAt: '2026-03-18T08:00:00.000Z',
    });

    expect(llmSettingsModule.getLLMSettings()).toEqual({
      apiKey: 'sk-registry-default',
      baseUrl: 'https://openai-proxy.example/v1',
      model: 'gpt-5.4',
    });
  });

  it('writes setters into registry default offering（setter 写入注册中心默认供给项）', async () => {
    const llmSettingsModule = await import('@/config/llm-settings');
    const storageModule = await import('@/lib/ai-registry/storage');
    const secretsModule = await import('@/lib/ai-registry/secrets');
    const resolutionModule = await import('@/lib/ai-registry/resolution');

    llmSettingsModule.setLLMBaseUrl('https://gateway.example/v1');
    llmSettingsModule.setLLMModel('gpt-5.4');
    llmSettingsModule.setLLMApiKey('sk-new-registry');

    const snapshot = storageModule.getAIRegistrySnapshot();
    const resolved = resolutionModule.resolveOfferingForCapability(snapshot, 'llm.chat');

    expect(resolved?.channel.apiHost).toBe('https://gateway.example/v1');
    expect(resolved?.model.displayName).toBe('gpt-5.4');
    expect(secretsModule.getAIEnergySecret(resolved?.energySource?.energySourceId ?? '')?.apiKey).toBe('sk-new-registry');
  });

  it('does not resurrect legacy llm settings after registry default is deleted（删除默认供给项后不应复活旧 LLM 配置）', async () => {
    const compatModule = await import('@/lib/ai-registry/compat');
    const adminModule = await import('@/lib/ai-registry/admin');
    const storageModule = await import('@/lib/ai-registry/storage');
    const resolutionModule = await import('@/lib/ai-registry/resolution');
    const llmSettingsModule = await import('@/config/llm-settings');

    localStorage.setItem('exomind:llmApiKey', 'sk-legacy-openai');
    localStorage.setItem('exomind:llmBaseUrl', 'https://legacy-openai.example/v1');
    localStorage.setItem('exomind:llmModel', 'gpt-legacy');

    expect(llmSettingsModule.getLLMSettings()).toEqual({
      apiKey: 'sk-legacy-openai',
      baseUrl: 'https://legacy-openai.example/v1',
      model: 'gpt-legacy',
    });

    const resolvedBeforeDelete = resolutionModule.resolveOfferingForCapability(
      storageModule.getAIRegistrySnapshot(),
      'llm.chat',
    );
    expect(resolvedBeforeDelete?.offering.offeringId).toBeTruthy();

    adminModule.deleteAIRegistryOffering(resolvedBeforeDelete!.offering.offeringId);

    expect(
      resolutionModule.resolveOfferingForCapability(
        storageModule.getAIRegistrySnapshot(),
        'llm.chat',
      ),
    ).toBeNull();

    expect(llmSettingsModule.getLLMSettings()).toEqual({
      apiKey: '',
      baseUrl: compatModule.DEFAULT_LLM_BASE_URL,
      model: compatModule.DEFAULT_LLM_MODEL,
    });

    expect(
      resolutionModule.resolveOfferingForCapability(
        storageModule.getAIRegistrySnapshot(),
        'llm.chat',
      ),
    ).toBeNull();
  });
});
