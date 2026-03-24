import { createUuidV4 } from '@/lib/utils/uuid';
import { getAIEnergySecret, saveAIEnergySecret } from './secrets';
import { getAIRegistrySnapshot, saveAIRegistrySnapshot } from './storage';
import type {
  AICapability,
  AIChannel,
  AIEnergySource,
  AILatencyTier,
  AIModel,
  AIModelModality,
  AIOffering,
  AIRegistrySnapshot,
  AIStabilityLevel,
} from './types';

const DEFAULT_TIMESTAMP = '2026-03-18T00:00:00.000Z';

export interface AIRegistryOfferingDraft {
  offeringId?: string;
  capabilityKey: string;
  capabilityDisplayName?: string;
  channelName: string;
  vendor: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  channelType?: AIChannel['channelType'];
  enabled?: boolean;
  setAsDefault?: boolean;
  qualityScoreManual?: number;
  stabilityLevelManual?: AIStabilityLevel;
  latencyTierManual?: AILatencyTier;
  notes?: string;
}

export interface AIRegistryOfferingSummary {
  offeringId: string;
  channelId: string;
  energySourceId: string;
  capabilityId: string;
  capabilityKey: string;
  capabilityDisplayName: string;
  channelName: string;
  vendor: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  enabled: boolean;
  isDefault: boolean;
  recommended: boolean;
  qualityScoreManual?: number;
  stabilityLevelManual?: AIStabilityLevel;
  latencyTierManual?: AILatencyTier;
  notes?: string;
  apiKeyConfigured: boolean;
  lastUsedAt?: string;
  updatedAt: string;
}

export interface AIRegistryCapabilitySummary {
  capabilityId: string;
  key: string;
  displayName: string;
  offeringCount: number;
  defaultOfferingId?: string;
  defaultLabel?: string;
}

export interface AIRegistryOfferingEditableDraft extends AIRegistryOfferingDraft {
  offeringId: string;
}

export const COMMON_AI_CAPABILITY_OPTIONS: Array<{ key: string; displayName: string }> = [
  { key: 'llm.chat', displayName: 'LLM Chat' },
  { key: 'llm.reason', displayName: 'LLM Reasoning' },
  { key: 'image.generate', displayName: 'Image Generate' },
  { key: 'audio.transcribe', displayName: 'Audio Transcribe' },
  { key: 'audio.tts', displayName: 'Audio TTS' },
  { key: 'video.generate', displayName: 'Video Generate' },
];

export const COMMON_AI_VENDOR_OPTIONS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'azure-openai',
  'aliyun',
  'volcengine',
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCapabilityDisplayName(capabilityKey: string, displayName?: string): string {
  const normalized = normalizeOptionalText(displayName);
  if (normalized) {
    return normalized;
  }
  const common = COMMON_AI_CAPABILITY_OPTIONS.find((item) => item.key === capabilityKey);
  return common?.displayName ?? capabilityKey;
}

function inferChannelType(baseUrl: string): AIChannel['channelType'] {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes('api.openai.com') || normalized.includes('api.anthropic.com')) {
    return 'official';
  }
  if (normalized.includes('openrouter') || normalized.includes('gateway')) {
    return 'aggregator';
  }
  return 'proxy';
}

function inferModelModality(capabilityKey: string, modelName: string): AIModelModality {
  const normalizedCapability = capabilityKey.toLowerCase();
  const normalizedModel = modelName.toLowerCase();
  if (normalizedCapability.startsWith('image') || normalizedModel.includes('image')) {
    return 'image';
  }
  if (normalizedCapability.startsWith('video') || normalizedModel.includes('video')) {
    return 'video';
  }
  if (normalizedCapability.startsWith('audio') || normalizedModel.includes('tts') || normalizedModel.includes('whisper')) {
    return 'audio';
  }
  if (normalizedCapability.includes('vision') || normalizedCapability.includes('multimodal')) {
    return 'multimodal';
  }
  if (normalizedCapability.includes('analysis')) {
    return 'analysis';
  }
  return 'llm';
}

function cloneSnapshot(snapshot = getAIRegistrySnapshot()): AIRegistrySnapshot {
  return {
    version: 1,
    channels: [...snapshot.channels],
    models: [...snapshot.models],
    capabilities: [...snapshot.capabilities],
    offerings: [...snapshot.offerings],
    energySources: [...snapshot.energySources],
    resolutionRules: [...snapshot.resolutionRules],
    updatedAt: snapshot.updatedAt,
  };
}

function buildCapabilityId(capabilityKey: string): string {
  if (capabilityKey === 'llm.chat') {
    return 'capability-llm-chat';
  }
  return `capability-${sanitizeIdPart(capabilityKey || createUuidV4())}`;
}

function buildRuleId(capabilityKey: string): string {
  if (capabilityKey === 'llm.chat') {
    return 'rule-llm-chat';
  }
  return `rule-${sanitizeIdPart(capabilityKey || createUuidV4())}`;
}

function buildOfferingIds(sourceKey: string, capabilityKey: string): {
  channelId: string;
  offeringId: string;
  energySourceId: string;
  credentialRef: string;
} {
  const normalizedSource = sanitizeIdPart(sourceKey || createUuidV4());
  const normalizedCapability = sanitizeIdPart(capabilityKey || 'capability');
  return {
    channelId: `channel-${normalizedSource}`,
    offeringId: `offering-${normalizedSource}-${normalizedCapability}`,
    energySourceId: `energy-${normalizedSource}`,
    credentialRef: `registry:${normalizedSource}`,
  };
}

function upsertCapability(
  snapshot: AIRegistrySnapshot,
  capabilityKey: string,
  capabilityDisplayName?: string,
): AICapability {
  const existing = snapshot.capabilities.find((item) => item.key === capabilityKey);
  if (existing) {
    existing.displayName = normalizeCapabilityDisplayName(capabilityKey, capabilityDisplayName);
    return existing;
  }

  const created: AICapability = {
    capabilityId: buildCapabilityId(capabilityKey),
    key: capabilityKey,
    displayName: normalizeCapabilityDisplayName(capabilityKey, capabilityDisplayName),
    inputKind: 'text',
    outputKind: 'text',
  };

  snapshot.capabilities.push(created);
  return created;
}

function upsertModel(
  snapshot: AIRegistrySnapshot,
  modelName: string,
  vendor: string,
  modality: AIModelModality,
): AIModel {
  const canonicalKey = sanitizeIdPart(modelName);
  const existing = snapshot.models.find((item) => item.canonicalKey === canonicalKey && item.vendor === vendor);
  if (existing) {
    if (!existing.aliases.includes(modelName)) {
      existing.aliases = [...existing.aliases, modelName];
    }
    existing.displayName = modelName;
    existing.modality = modality;
    return existing;
  }

  const created: AIModel = {
    modelId: `model-${canonicalKey || sanitizeIdPart(createUuidV4())}`,
    canonicalKey,
    displayName: modelName,
    vendor,
    modality,
    aliases: [modelName],
    deprecated: false,
  };

  snapshot.models.push(created);
  return created;
}

function materializeOfferingSummary(
  snapshot: AIRegistrySnapshot,
  offering: AIOffering,
): AIRegistryOfferingSummary | null {
  const capability = snapshot.capabilities.find((item) => item.capabilityId === offering.capabilityId);
  const channel = snapshot.channels.find((item) => item.channelId === offering.channelId);
  const model = snapshot.models.find((item) => item.modelId === offering.modelId);
  const energySource = snapshot.energySources.find((item) => item.channelId === offering.channelId);
  if (!capability || !channel || !model || !energySource) {
    return null;
  }

  const rule = snapshot.resolutionRules.find((item) => item.targetKey === capability.key);
  const secret = getAIEnergySecret(energySource.energySourceId);

  return {
    offeringId: offering.offeringId,
    channelId: channel.channelId,
    energySourceId: energySource.energySourceId,
    capabilityId: capability.capabilityId,
    capabilityKey: capability.key,
    capabilityDisplayName: capability.displayName,
    channelName: channel.name,
    vendor: channel.vendor,
    baseUrl: channel.apiHost,
    modelId: model.modelId,
    modelName: model.displayName,
    enabled: offering.enabled,
    isDefault: rule?.defaultOfferingId === offering.offeringId,
    recommended: offering.recommended,
    qualityScoreManual: offering.qualityScoreManual,
    stabilityLevelManual: offering.stabilityLevelManual,
    latencyTierManual: offering.latencyTierManual,
    notes: offering.notes,
    apiKeyConfigured: Boolean(secret?.apiKey),
    lastUsedAt: offering.lastUsedAt,
    updatedAt: channel.updatedAt,
  };
}

function syncResolutionRule(
  snapshot: AIRegistrySnapshot,
  capabilityKey: string,
  capabilityId: string,
  preferredDefaultOfferingId?: string,
): void {
  const enabledOfferings = snapshot.offerings.filter((item) => item.enabled && item.capabilityId === capabilityId);
  const ruleIndex = snapshot.resolutionRules.findIndex((item) => item.targetKey === capabilityKey);

  if (enabledOfferings.length === 0) {
    if (ruleIndex >= 0) {
      snapshot.resolutionRules.splice(ruleIndex, 1);
    }
    return;
  }

  const currentRule = ruleIndex >= 0 ? snapshot.resolutionRules[ruleIndex] : null;
  const fallbackCandidates = enabledOfferings.map((item) => item.offeringId);
  let defaultOfferingId = preferredDefaultOfferingId
    ?? currentRule?.defaultOfferingId
    ?? enabledOfferings.find((item) => item.recommended)?.offeringId
    ?? enabledOfferings[0]?.offeringId;

  if (!fallbackCandidates.includes(defaultOfferingId ?? '')) {
    defaultOfferingId = enabledOfferings[0]?.offeringId;
  }

  const nextRule = {
    ruleId: currentRule?.ruleId ?? buildRuleId(capabilityKey),
    targetKey: capabilityKey,
    defaultOfferingId,
    fallbackOfferingIds: fallbackCandidates.filter((item) => item !== defaultOfferingId),
  };

  if (ruleIndex >= 0) {
    snapshot.resolutionRules[ruleIndex] = nextRule;
  } else {
    snapshot.resolutionRules.push(nextRule);
  }
}

function cleanupUnusedChannels(snapshot: AIRegistrySnapshot): void {
  const usedChannelIds = new Set(snapshot.offerings.map((item) => item.channelId));
  snapshot.channels = snapshot.channels.filter((item) => usedChannelIds.has(item.channelId));
  snapshot.energySources = snapshot.energySources.filter((item) => usedChannelIds.has(item.channelId));
}

export function listAIRegistryOfferings(snapshot = getAIRegistrySnapshot()): AIRegistryOfferingSummary[] {
  return snapshot.offerings
    .map((item) => materializeOfferingSummary(snapshot, item))
    .filter((item): item is AIRegistryOfferingSummary => Boolean(item))
    .sort((left, right) => {
      const leftRank = left.lastUsedAt ?? left.updatedAt;
      const rightRank = right.lastUsedAt ?? right.updatedAt;
      return rightRank.localeCompare(leftRank);
    });
}

export function listAIRegistryCapabilities(snapshot = getAIRegistrySnapshot()): AIRegistryCapabilitySummary[] {
  return snapshot.capabilities
    .map((capability) => {
      const offerings = snapshot.offerings.filter((item) => item.capabilityId === capability.capabilityId);
      const rule = snapshot.resolutionRules.find((item) => item.targetKey === capability.key);
      const defaultOffering = offerings.find((item) => item.offeringId === rule?.defaultOfferingId)
        ?? offerings.find((item) => item.recommended)
        ?? offerings[0];
      const defaultSummary = defaultOffering ? materializeOfferingSummary(snapshot, defaultOffering) : null;

      return {
        capabilityId: capability.capabilityId,
        key: capability.key,
        displayName: capability.displayName,
        offeringCount: offerings.length,
        defaultOfferingId: defaultSummary?.offeringId,
        defaultLabel: defaultSummary ? `${defaultSummary.channelName} / ${defaultSummary.modelName}` : undefined,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function getAIRegistryOfferingDraft(offeringId: string): AIRegistryOfferingEditableDraft | null {
  const snapshot = getAIRegistrySnapshot();
  const offering = snapshot.offerings.find((item) => item.offeringId === offeringId);
  if (!offering) {
    return null;
  }

  const summary = materializeOfferingSummary(snapshot, offering);
  if (!summary) {
    return null;
  }

  const secret = getAIEnergySecret(summary.energySourceId);
  return {
    offeringId: summary.offeringId,
    capabilityKey: summary.capabilityKey,
    capabilityDisplayName: summary.capabilityDisplayName,
    channelName: summary.channelName,
    vendor: summary.vendor,
    baseUrl: summary.baseUrl,
    model: summary.modelName,
    apiKey: secret?.apiKey ?? '',
    enabled: summary.enabled,
    setAsDefault: summary.isDefault,
    qualityScoreManual: summary.qualityScoreManual,
    stabilityLevelManual: summary.stabilityLevelManual,
    latencyTierManual: summary.latencyTierManual,
    notes: summary.notes,
  };
}

export function saveAIRegistryOfferingDraft(draft: AIRegistryOfferingDraft): AIRegistryOfferingSummary {
  const snapshot = cloneSnapshot();
  const capabilityKey = normalizeRequiredText(draft.capabilityKey, 'capabilityKey');
  const channelName = normalizeRequiredText(draft.channelName, 'channelName');
  const vendor = normalizeRequiredText(draft.vendor, 'vendor').toLowerCase();
  const baseUrl = normalizeRequiredText(draft.baseUrl, 'baseUrl');
  const modelName = normalizeRequiredText(draft.model, 'model');
  const apiKey = normalizeRequiredText(draft.apiKey, 'apiKey');
  const updatedAt = nowIso();

  const existingOffering = draft.offeringId
    ? snapshot.offerings.find((item) => item.offeringId === draft.offeringId)
    : null;
  const existingChannel = existingOffering
    ? snapshot.channels.find((item) => item.channelId === existingOffering.channelId)
    : null;
  const existingEnergy = existingOffering
    ? snapshot.energySources.find((item) => item.channelId === existingOffering.channelId)
    : null;

  const ids = existingOffering
    ? {
        channelId: existingOffering.channelId,
        offeringId: existingOffering.offeringId,
        energySourceId: existingEnergy?.energySourceId ?? `energy-${sanitizeIdPart(existingOffering.channelId)}`,
        credentialRef: existingEnergy?.credentialRef ?? `registry:${sanitizeIdPart(existingOffering.channelId)}`,
      }
    : buildOfferingIds(createUuidV4(), capabilityKey);

  const capability = upsertCapability(snapshot, capabilityKey, draft.capabilityDisplayName);
  const model = upsertModel(snapshot, modelName, vendor, inferModelModality(capabilityKey, modelName));
  const createdAt = existingChannel?.createdAt ?? existingEnergy?.createdAt ?? updatedAt ?? DEFAULT_TIMESTAMP;
  const enabled = draft.enabled ?? existingOffering?.enabled ?? true;

  const channelRecord: AIChannel = {
    channelId: ids.channelId,
    name: channelName,
    vendor,
    channelType: draft.channelType ?? existingChannel?.channelType ?? inferChannelType(baseUrl),
    apiHost: baseUrl,
    authKind: 'api_key',
    enabled,
    createdAt,
    updatedAt,
  };

  const channelIndex = snapshot.channels.findIndex((item) => item.channelId === ids.channelId);
  if (channelIndex >= 0) {
    snapshot.channels[channelIndex] = channelRecord;
  } else {
    snapshot.channels.push(channelRecord);
  }

  const energyRecord: AIEnergySource = {
    energySourceId: ids.energySourceId,
    channelId: ids.channelId,
    accountLabel: channelName,
    credentialRef: ids.credentialRef,
    createdAt,
    updatedAt,
  };

  const energyIndex = snapshot.energySources.findIndex((item) => item.energySourceId === ids.energySourceId);
  if (energyIndex >= 0) {
    snapshot.energySources[energyIndex] = {
      ...snapshot.energySources[energyIndex]!,
      ...energyRecord,
    };
  } else {
    snapshot.energySources.push(energyRecord);
  }

  const offeringRecord: AIOffering = {
    offeringId: ids.offeringId,
    channelId: ids.channelId,
    modelId: model.modelId,
    capabilityId: capability.capabilityId,
    enabled,
    recommended: draft.setAsDefault ?? existingOffering?.recommended ?? false,
    lastUsedAt: existingOffering?.lastUsedAt,
    qualityScoreManual: draft.qualityScoreManual,
    stabilityLevelManual: draft.stabilityLevelManual,
    latencyTierManual: draft.latencyTierManual,
    notes: normalizeOptionalText(draft.notes),
  };

  const offeringIndex = snapshot.offerings.findIndex((item) => item.offeringId === ids.offeringId);
  if (offeringIndex >= 0) {
    snapshot.offerings[offeringIndex] = {
      ...snapshot.offerings[offeringIndex]!,
      ...offeringRecord,
    };
  } else {
    snapshot.offerings.push(offeringRecord);
  }

  syncResolutionRule(
    snapshot,
    capability.key,
    capability.capabilityId,
    draft.setAsDefault ? ids.offeringId : undefined,
  );

  snapshot.updatedAt = updatedAt;
  saveAIRegistrySnapshot(snapshot);
  saveAIEnergySecret(ids.energySourceId, {
    apiKey,
    updatedAt,
  });

  const summary = listAIRegistryOfferings(getAIRegistrySnapshot()).find((item) => item.offeringId === ids.offeringId);
  if (!summary) {
    throw new Error('failed to materialize registry offering summary');
  }
  return summary;
}

export function setAIRegistryDefaultOffering(offeringId: string): AIRegistryOfferingSummary | null {
  const snapshot = cloneSnapshot();
  const offering = snapshot.offerings.find((item) => item.offeringId === offeringId);
  if (!offering) {
    return null;
  }

  const capability = snapshot.capabilities.find((item) => item.capabilityId === offering.capabilityId);
  if (!capability) {
    return null;
  }

  snapshot.offerings = snapshot.offerings.map((item) => (
    item.capabilityId === capability.capabilityId
      ? { ...item, recommended: item.offeringId === offeringId }
      : item
  ));
  syncResolutionRule(snapshot, capability.key, capability.capabilityId, offeringId);
  snapshot.updatedAt = nowIso();
  saveAIRegistrySnapshot(snapshot);

  return listAIRegistryOfferings(getAIRegistrySnapshot()).find((item) => item.offeringId === offeringId) ?? null;
}

export function deleteAIRegistryOffering(offeringId: string): void {
  const snapshot = cloneSnapshot();
  const offering = snapshot.offerings.find((item) => item.offeringId === offeringId);
  if (!offering) {
    return;
  }

  const capability = snapshot.capabilities.find((item) => item.capabilityId === offering.capabilityId);
  snapshot.offerings = snapshot.offerings.filter((item) => item.offeringId !== offeringId);
  cleanupUnusedChannels(snapshot);

  if (capability) {
    syncResolutionRule(snapshot, capability.key, capability.capabilityId);
  }

  snapshot.updatedAt = nowIso();
  saveAIRegistrySnapshot(snapshot);
}
