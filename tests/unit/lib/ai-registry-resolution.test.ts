import { describe, expect, it } from 'vitest';
import type { AIRegistrySnapshot } from '@/lib/ai-registry/types';
import { resolveOfferingForCapability } from '@/lib/ai-registry/resolution';

const seedSnapshot: AIRegistrySnapshot = {
  version: 1,
  channels: [
    {
      channelId: 'channel-openai-official',
      name: 'OpenAI Official',
      vendor: 'openai',
      channelType: 'official',
      apiHost: 'https://api.openai.com/v1',
      authKind: 'api_key',
      enabled: true,
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:00.000Z',
    },
  ],
  models: [
    {
      modelId: 'model-gpt-5',
      canonicalKey: 'gpt-5',
      displayName: 'GPT-5',
      vendor: 'openai',
      modality: 'llm',
      aliases: ['gpt-5'],
      deprecated: false,
    },
  ],
  capabilities: [
    {
      capabilityId: 'cap-llm-chat',
      key: 'llm.chat',
      displayName: 'Chat',
      inputKind: 'text',
      outputKind: 'text',
    },
  ],
  offerings: [
    {
      offeringId: 'openai-gpt5-chat',
      channelId: 'channel-openai-official',
      modelId: 'model-gpt-5',
      capabilityId: 'cap-llm-chat',
      enabled: true,
      recommended: true,
    },
  ],
  energySources: [
    {
      energySourceId: 'energy-openai-main',
      channelId: 'channel-openai-official',
      accountLabel: 'Main',
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:00.000Z',
    },
  ],
  resolutionRules: [
    {
      ruleId: 'rule-llm-chat',
      targetKey: 'llm.chat',
      defaultOfferingId: 'openai-gpt5-chat',
      fallbackOfferingIds: [],
    },
  ],
  updatedAt: '2026-03-18T00:00:00.000Z',
};

describe('ai-registry resolution（AI 注册中心解析）', () => {
  it('prefers explicit default offering then fallbacks（优先默认 offering，再退回 fallback）', () => {
    const result = resolveOfferingForCapability(seedSnapshot, 'llm.chat');

    expect(result?.offering.offeringId).toBe('openai-gpt5-chat');
    expect(result?.model.canonicalKey).toBe('gpt-5');
    expect(result?.channel.channelId).toBe('channel-openai-official');
    expect(result?.energySource?.energySourceId).toBe('energy-openai-main');
  });
});
