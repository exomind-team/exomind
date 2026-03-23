import type { ApiProviderId, ProviderProfileSnapshot } from '@/lib/agent-provider/types';
import type { ResolvedAIOffering } from './resolution';

function toCompatProviderId(vendor: string): ApiProviderId {
  return vendor === 'anthropic' ? 'anthropic' : 'openai';
}

export function toRuntimeProviderProfileCompat(
  resolved: ResolvedAIOffering,
  apiKey: string,
): ProviderProfileSnapshot {
  return {
    profileId: `registry-${resolved.offering.offeringId}`,
    name: `${resolved.channel.name} · ${resolved.model.displayName}`,
    provider: toCompatProviderId(resolved.channel.vendor || resolved.model.vendor),
    model: resolved.model.displayName,
    baseUrl: resolved.channel.apiHost,
    apiKey,
    createdAt: resolved.channel.createdAt,
    updatedAt: resolved.channel.updatedAt,
  };
}
