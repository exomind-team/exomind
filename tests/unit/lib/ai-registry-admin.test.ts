import { beforeEach, describe, expect, it } from 'vitest';
import { getAIEnergySecret } from '@/lib/ai-registry/secrets';
import { getAIRegistrySnapshot } from '@/lib/ai-registry/storage';
import {
  deleteAIRegistryOffering,
  listAIRegistryCapabilities,
  listAIRegistryOfferings,
  saveAIRegistryOfferingDraft,
} from '@/lib/ai-registry/admin';

describe('ai-registry admin（AI 注册中心多供给项管理）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates multiple channels and defaults across capabilities（支持多渠道与多能力默认映射）', () => {
    const primaryChat = saveAIRegistryOfferingDraft({
      capabilityKey: 'llm.chat',
      capabilityDisplayName: 'LLM Chat',
      channelName: 'OpenAI Official',
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiKey: 'sk-openai-primary',
      setAsDefault: true,
    });

    const gatewayChat = saveAIRegistryOfferingDraft({
      capabilityKey: 'llm.chat',
      capabilityDisplayName: 'LLM Chat',
      channelName: 'Gateway Alpha',
      vendor: 'openrouter',
      baseUrl: 'https://gateway.alpha/v1',
      model: 'gpt-5.4',
      apiKey: 'sk-gateway-alpha',
      setAsDefault: false,
    });

    const imageOffering = saveAIRegistryOfferingDraft({
      capabilityKey: 'image.generate',
      capabilityDisplayName: 'Image Generate',
      channelName: 'Image Gateway',
      vendor: 'openai',
      baseUrl: 'https://images.example/v1',
      model: 'gpt-image-1',
      apiKey: 'sk-image-gateway',
      setAsDefault: true,
    });

    const snapshot = getAIRegistrySnapshot();
    expect(snapshot.channels).toHaveLength(3);
    expect(snapshot.offerings).toHaveLength(3);
    expect(snapshot.energySources).toHaveLength(3);
    expect(snapshot.capabilities.map((item) => item.key)).toEqual(['llm.chat', 'image.generate']);

    const chatRule = snapshot.resolutionRules.find((item) => item.targetKey === 'llm.chat');
    expect(chatRule?.defaultOfferingId).toBe(primaryChat.offeringId);
    expect(chatRule?.fallbackOfferingIds).toContain(gatewayChat.offeringId);

    const imageRule = snapshot.resolutionRules.find((item) => item.targetKey === 'image.generate');
    expect(imageRule?.defaultOfferingId).toBe(imageOffering.offeringId);

    const offerings = listAIRegistryOfferings();
    expect(offerings).toHaveLength(3);
    expect(offerings.find((item) => item.offeringId === primaryChat.offeringId)?.isDefault).toBe(true);
    expect(offerings.find((item) => item.offeringId === gatewayChat.offeringId)?.isDefault).toBe(false);
    expect(offerings.find((item) => item.offeringId === imageOffering.offeringId)?.capabilityKey).toBe('image.generate');

    const defaults = listAIRegistryCapabilities();
    expect(defaults.find((item) => item.key === 'llm.chat')?.defaultOfferingId).toBe(primaryChat.offeringId);
    expect(defaults.find((item) => item.key === 'image.generate')?.defaultOfferingId).toBe(imageOffering.offeringId);

    const firstSecret = getAIEnergySecret(primaryChat.energySourceId);
    const imageSecret = getAIEnergySecret(imageOffering.energySourceId);
    expect(firstSecret?.apiKey).toBe('sk-openai-primary');
    expect(imageSecret?.apiKey).toBe('sk-image-gateway');
  });

  it('promotes fallback when deleting the default offering（删除默认供给项时自动提升 fallback）', () => {
    const primaryChat = saveAIRegistryOfferingDraft({
      capabilityKey: 'llm.chat',
      capabilityDisplayName: 'LLM Chat',
      channelName: 'OpenAI Official',
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiKey: 'sk-openai-primary',
      setAsDefault: true,
    });

    const gatewayChat = saveAIRegistryOfferingDraft({
      capabilityKey: 'llm.chat',
      capabilityDisplayName: 'LLM Chat',
      channelName: 'Gateway Alpha',
      vendor: 'openrouter',
      baseUrl: 'https://gateway.alpha/v1',
      model: 'gpt-5.4',
      apiKey: 'sk-gateway-alpha',
      setAsDefault: false,
    });

    deleteAIRegistryOffering(primaryChat.offeringId);

    const snapshot = getAIRegistrySnapshot();
    expect(snapshot.offerings).toHaveLength(1);
    expect(snapshot.channels).toHaveLength(1);
    expect(snapshot.energySources).toHaveLength(1);

    const chatRule = snapshot.resolutionRules.find((item) => item.targetKey === 'llm.chat');
    expect(chatRule?.defaultOfferingId).toBe(gatewayChat.offeringId);
    expect(chatRule?.fallbackOfferingIds).toEqual([]);

    const offerings = listAIRegistryOfferings();
    expect(offerings).toHaveLength(1);
    expect(offerings[0]?.channelName).toBe('Gateway Alpha');
    expect(offerings[0]?.isDefault).toBe(true);
  });
});
