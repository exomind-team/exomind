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

describe('ai-registry storage（AI 注册中心存储）', () => {
  beforeEach(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('persists snapshot and energy secrets separately（快照与密钥分离存储）', async () => {
    const storageModule = await import('@/lib/ai-registry/storage');
    const secretsModule = await import('@/lib/ai-registry/secrets');

    storageModule.saveAIRegistrySnapshot({
      version: 1,
      channels: [{
        channelId: 'openai-official',
        name: 'OpenAI Official',
        vendor: 'openai',
        channelType: 'official',
        apiHost: 'https://api.openai.com/v1',
        authKind: 'api_key',
        enabled: true,
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
      }],
      models: [],
      capabilities: [],
      offerings: [],
      energySources: [{
        energySourceId: 'energy-openai-main',
        channelId: 'openai-official',
        accountLabel: 'Main',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
      }],
      resolutionRules: [],
      updatedAt: '2026-03-18T00:00:00.000Z',
    });
    secretsModule.saveAIEnergySecret('energy-openai-main', {
      apiKey: 'sk-test',
      updatedAt: '2026-03-18T00:00:00.000Z',
    });

    expect(storageModule.getAIRegistrySnapshot().channels).toHaveLength(1);
    expect(secretsModule.getAIEnergySecret('energy-openai-main')?.apiKey).toBe('sk-test');
    expect(Object.keys(mockLocalStorageData)).toHaveLength(2);
    expect(Object.values(mockLocalStorageData).some((value) => value.includes('"channels"'))).toBe(true);
    expect(Object.values(mockLocalStorageData).some((value) => value.includes('"apiKey":"sk-test"'))).toBe(true);
  });
});
