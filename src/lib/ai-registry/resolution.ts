import type {
  AIChannel,
  AIEnergySource,
  AIModel,
  AIOffering,
  AIRegistrySnapshot,
} from './types';

export interface ResolvedAIOffering {
  offering: AIOffering;
  model: AIModel;
  channel: AIChannel;
  energySource: AIEnergySource | null;
}

function findOfferingById(
  snapshot: AIRegistrySnapshot,
  offeringId: string | undefined,
): AIOffering | null {
  if (!offeringId) {
    return null;
  }

  return snapshot.offerings.find((item) => item.offeringId === offeringId && item.enabled) ?? null;
}

function findCapabilityId(snapshot: AIRegistrySnapshot, capabilityKey: string): string | null {
  return snapshot.capabilities.find((item) => item.key === capabilityKey)?.capabilityId ?? null;
}

function materializeResolvedOffering(
  snapshot: AIRegistrySnapshot,
  offering: AIOffering | null,
): ResolvedAIOffering | null {
  if (!offering) {
    return null;
  }

  const model = snapshot.models.find((item) => item.modelId === offering.modelId);
  const channel = snapshot.channels.find((item) => item.channelId === offering.channelId);
  if (!model || !channel) {
    return null;
  }

  return {
    offering,
    model,
    channel,
    energySource: snapshot.energySources.find((item) => item.channelId === offering.channelId) ?? null,
  };
}

export function resolveOfferingForCapability(
  snapshot: AIRegistrySnapshot,
  capabilityKey: string,
): ResolvedAIOffering | null {
  const capabilityId = findCapabilityId(snapshot, capabilityKey);
  if (!capabilityId) {
    return null;
  }

  const rule = snapshot.resolutionRules.find((item) => item.targetKey === capabilityKey);
  const explicit = materializeResolvedOffering(snapshot, findOfferingById(snapshot, rule?.defaultOfferingId));
  if (explicit) {
    return explicit;
  }

  for (const fallbackOfferingId of rule?.fallbackOfferingIds ?? []) {
    const fallback = materializeResolvedOffering(snapshot, findOfferingById(snapshot, fallbackOfferingId));
    if (fallback) {
      return fallback;
    }
  }

  const recommended = snapshot.offerings.find((item) => item.capabilityId === capabilityId && item.enabled && item.recommended);
  const recommendedResolved = materializeResolvedOffering(snapshot, recommended ?? null);
  if (recommendedResolved) {
    return recommendedResolved;
  }

  return materializeResolvedOffering(
    snapshot,
    snapshot.offerings.find((item) => item.capabilityId === capabilityId && item.enabled) ?? null,
  );
}
