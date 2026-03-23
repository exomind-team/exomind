import { describe, expect, it } from 'vitest';
import { buildRegistryFromLegacySources } from '@/lib/ai-registry/migration';

describe('ai-registry migration（AI 注册中心迁移）', () => {
  it('converts llm settings and provider profiles into one registry snapshot（将旧设置合并进统一快照）', () => {
    const snapshot = buildRegistryFromLegacySources({
      llmSettings: {
        apiKey: 'sk-openai-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
      providerProfiles: [
        {
          profileId: 'provider-1',
          name: 'Claude Proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          apiKey: 'sk-anthropic-test',
          baseUrl: 'https://proxy.example.com/v1',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    });

    expect(snapshot.channels).toHaveLength(2);
    expect(snapshot.models.some((item) => item.canonicalKey === 'gpt-4o')).toBe(true);
    expect(snapshot.models.some((item) => item.canonicalKey === 'claude-sonnet-4-5')).toBe(true);
    expect(snapshot.offerings.some((item) => item.capabilityId === 'capability-llm-chat')).toBe(true);
    expect(snapshot.energySources).toHaveLength(2);
    expect(snapshot.resolutionRules.some((item) => item.targetKey === 'llm.chat')).toBe(true);
  });
});
