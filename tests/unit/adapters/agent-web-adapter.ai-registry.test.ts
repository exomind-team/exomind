import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWebAdapter } from '@/lib/adapters/agent-web-adapter';
import type { AIRegistrySnapshot } from '@/lib/ai-registry/types';

function createRegistrySnapshot(): AIRegistrySnapshot {
  return {
    version: 1,
    channels: [
      {
        channelId: 'channel-default-chat',
        name: 'Default Chat Channel',
        vendor: 'openai',
        channelType: 'proxy',
        apiHost: 'https://gateway.example/v1',
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

describe('agent-web-adapter ai registry compat（AgentWebAdapter 注册中心兼容）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('uses registry-backed llm settings for chat streaming（使用注册中心默认 llm 设置发起对话）', async () => {
    const storageModule = await import('@/lib/ai-registry/storage');
    const secretsModule = await import('@/lib/ai-registry/secrets');

    storageModule.saveAIRegistrySnapshot(createRegistrySnapshot());
    secretsModule.saveAIEnergySecret('energy-default-chat', {
      apiKey: 'sk-registry-stream',
      updatedAt: '2026-03-18T08:00:00.000Z',
    });

    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AgentWebAdapter();
    const deltas: string[] = [];

    for await (const chunk of adapter.streamConversation({
      agentId: 'agent-web',
      prompt: 'hello',
    })) {
      deltas.push(chunk.delta);
    }

    expect(deltas.join('')).toContain('你好');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-registry-stream',
        }),
      }),
    );
  });
});
