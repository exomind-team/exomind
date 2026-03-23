import { createUuidV4 } from '@/lib/utils/uuid';
import type {
  ApiProviderId,
  CreateProviderProfileInput,
  ProviderProfileMeta,
  ProviderProfileSecret,
  ProviderProfileSnapshot,
  UpdateProviderProfileInput,
} from '@/lib/agent-provider/types';
import { getAIEnergySecret, saveAIEnergySecret } from './secrets';
import { getAIRegistrySnapshot, saveAIRegistrySnapshot } from './storage';
import type {
  AICapability,
  AIChannel,
  AIEnergySource,
  AIModel,
  AIOffering,
  AIRegistrySnapshot,
  AIResolutionRule,
} from './types';

export interface RegistryDefaultLLMDraft {
  channelName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface RegistryOfferingMaterialized {
  offering: AIOffering;
  model: AIModel;
  channel: AIChannel;
  energySource: AIEnergySource | null;
}

interface RegistryProfileSeed {
  sourceKey?: string;
  profileId?: string;
  name: string;
  provider: ApiProviderId;
  model: string;
  baseUrl?: string;
  apiKey: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
  recommended?: boolean;
  setAsDefault?: boolean;
}

const DEFAULT_TIMESTAMP = '2026-03-18T00:00:00.000Z';
export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_LLM_MODEL = 'gpt-4o';
export const DEFAULT_LLM_CHANNEL_NAME = 'Primary LLM Channel';
export const DEFAULT_LLM_SOURCE_KEY = 'default-llm-chat';
export const LLM_CHAT_CAPABILITY_ID = 'capability-llm-chat';
export const LLM_CHAT_CAPABILITY_KEY = 'llm.chat';
const LLM_CHAT_RULE_ID = 'rule-llm-chat';

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

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function inferChannelType(baseUrl: string): AIChannel['channelType'] {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes('api.openai.com') || normalized.includes('api.anthropic.com')) {
    return 'official';
  }
  return 'proxy';
}

function maxIso(...values: Array<string | undefined>): string {
  let current = '';
  for (const value of values) {
    if (typeof value === 'string' && value > current) {
      current = value;
    }
  }
  return current;
}

function buildModelCanonicalKey(model: string): string {
  return sanitizeIdPart(model);
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

function getLLMChatCapability(): AICapability {
  return {
    capabilityId: LLM_CHAT_CAPABILITY_ID,
    key: LLM_CHAT_CAPABILITY_KEY,
    displayName: 'LLM Chat',
    inputKind: 'text',
    outputKind: 'text',
  };
}

function ensureLLMChatCapability(snapshot: AIRegistrySnapshot): void {
  if (!snapshot.capabilities.some((item) => item.key === LLM_CHAT_CAPABILITY_KEY)) {
    snapshot.capabilities.push(getLLMChatCapability());
  }
}

function getLLMChatCapabilityId(snapshot: AIRegistrySnapshot): string {
  ensureLLMChatCapability(snapshot);
  return snapshot.capabilities.find((item) => item.key === LLM_CHAT_CAPABILITY_KEY)?.capabilityId
    ?? LLM_CHAT_CAPABILITY_ID;
}

function materializeOffering(
  snapshot: AIRegistrySnapshot,
  offering: AIOffering | undefined,
): RegistryOfferingMaterialized | null {
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

function resolveExplicitDefaultLLMOffering(snapshot = getAIRegistrySnapshot()): RegistryOfferingMaterialized | null {
  const rule = snapshot.resolutionRules.find((item) => item.targetKey === LLM_CHAT_CAPABILITY_KEY);
  const ruleResolved = materializeOffering(
    snapshot,
    snapshot.offerings.find((item) => item.offeringId === rule?.defaultOfferingId && item.enabled),
  );
  if (ruleResolved) {
    return ruleResolved;
  }

  const capabilityId = snapshot.capabilities.find((item) => item.key === LLM_CHAT_CAPABILITY_KEY)?.capabilityId;
  const recommendedResolved = materializeOffering(
    snapshot,
    snapshot.offerings.find((item) => item.enabled && item.recommended && item.capabilityId === capabilityId),
  );
  if (recommendedResolved) {
    return recommendedResolved;
  }

  return null;
}

export function buildRegistryOfferingIds(sourceKey: string): {
  channelId: string;
  offeringId: string;
  energySourceId: string;
  credentialRef: string;
} {
  const normalized = sanitizeIdPart(sourceKey || createUuidV4());
  return {
    channelId: `channel-${normalized}`,
    offeringId: `offering-${normalized}-llm-chat`,
    energySourceId: `energy-${normalized}`,
    credentialRef: `registry:${normalized}`,
  };
}

function parseProfileOfferingId(profileId: string): string | null {
  if (!profileId.startsWith('registry-')) {
    return null;
  }
  return profileId.slice('registry-'.length);
}

function createProfileId(offeringId: string): string {
  return `registry-${offeringId}`;
}

export function buildRegistryProfileIdFromSourceKey(sourceKey: string): string {
  return createProfileId(buildRegistryOfferingIds(sourceKey).offeringId);
}

function toCompatProviderId(vendor: string, apiHost?: string): ApiProviderId {
  const normalizedVendor = vendor.toLowerCase();
  const normalizedHost = apiHost?.toLowerCase() ?? '';
  if (normalizedVendor.includes('anthropic') || normalizedHost.includes('anthropic')) {
    return 'anthropic';
  }
  return 'openai';
}

function upsertModel(snapshot: AIRegistrySnapshot, modelName: string, provider: ApiProviderId): string {
  const canonicalKey = buildModelCanonicalKey(modelName);
  const existing = snapshot.models.find((item) => item.canonicalKey === canonicalKey);
  if (existing) {
    if (!existing.aliases.includes(modelName)) {
      existing.aliases = [...existing.aliases, modelName];
    }
    return existing.modelId;
  }

  const modelId = `model-${canonicalKey || sanitizeIdPart(createUuidV4())}`;
  snapshot.models.push({
    modelId,
    canonicalKey,
    displayName: modelName,
    vendor: provider,
    modality: 'llm',
    aliases: [modelName],
    deprecated: false,
  });
  return modelId;
}

function upsertResolutionRule(
  snapshot: AIRegistrySnapshot,
  offeringId: string,
): void {
  const existing = snapshot.resolutionRules.find((item) => item.targetKey === LLM_CHAT_CAPABILITY_KEY);
  const allFallbackIds = snapshot.offerings
    .filter((item) => item.enabled && item.capabilityId === getLLMChatCapabilityId(snapshot) && item.offeringId !== offeringId)
    .map((item) => item.offeringId);

  if (existing) {
    existing.defaultOfferingId = offeringId;
    existing.fallbackOfferingIds = Array.from(new Set([
      ...existing.fallbackOfferingIds.filter((item) => item !== offeringId),
      ...allFallbackIds,
    ]));
    return;
  }

  const rule: AIResolutionRule = {
    ruleId: LLM_CHAT_RULE_ID,
    targetKey: LLM_CHAT_CAPABILITY_KEY,
    defaultOfferingId: offeringId,
    fallbackOfferingIds: allFallbackIds,
  };
  snapshot.resolutionRules.push(rule);
}

function saveRegistryProfileSeed(input: RegistryProfileSeed): ProviderProfileMeta {
  const name = normalizeRequiredText(input.name, 'name');
  const model = normalizeRequiredText(input.model, 'model');
  const apiKey = input.apiKey.trim();
  const baseUrl = normalizeOptionalText(input.baseUrl) ?? (input.setAsDefault ? DEFAULT_LLM_BASE_URL : '');
  const updatedAt = input.updatedAt ?? nowIso();
  const snapshot = cloneSnapshot();
  ensureLLMChatCapability(snapshot);

  const existingOfferingId = input.profileId ? parseProfileOfferingId(input.profileId) : null;
  const existingOffering = existingOfferingId
    ? snapshot.offerings.find((item) => item.offeringId === existingOfferingId)
    : null;
  const existingMaterialized = materializeOffering(snapshot, existingOffering ?? undefined);

  const ids = existingMaterialized
    ? {
        channelId: existingMaterialized.channel.channelId,
        offeringId: existingMaterialized.offering.offeringId,
        energySourceId: existingMaterialized.energySource?.energySourceId
          ?? `energy-${sanitizeIdPart(existingMaterialized.channel.channelId)}`,
        credentialRef: existingMaterialized.energySource?.credentialRef
          ?? `registry:${sanitizeIdPart(existingMaterialized.channel.channelId)}`,
      }
    : buildRegistryOfferingIds(input.sourceKey ?? createUuidV4());

  const createdAt = input.createdAt
    ?? existingMaterialized?.energySource?.createdAt
    ?? existingMaterialized?.channel.createdAt
    ?? updatedAt
    ?? DEFAULT_TIMESTAMP;
  const capabilityId = getLLMChatCapabilityId(snapshot);
  const modelId = upsertModel(snapshot, model, input.provider);

  const channelIndex = snapshot.channels.findIndex((item) => item.channelId === ids.channelId);
  const channelRecord: AIChannel = {
    channelId: ids.channelId,
    name,
    vendor: input.provider,
    channelType: inferChannelType(baseUrl),
    apiHost: baseUrl,
    authKind: 'api_key',
    enabled: true,
    createdAt: channelIndex >= 0 ? snapshot.channels[channelIndex]!.createdAt : createdAt,
    updatedAt,
  };
  if (channelIndex >= 0) {
    snapshot.channels[channelIndex] = channelRecord;
  } else {
    snapshot.channels.push(channelRecord);
  }

  const energyIndex = snapshot.energySources.findIndex((item) => item.energySourceId === ids.energySourceId);
  const energyRecord: AIEnergySource = {
    energySourceId: ids.energySourceId,
    channelId: ids.channelId,
    accountLabel: name,
    credentialRef: ids.credentialRef,
    createdAt: energyIndex >= 0 ? snapshot.energySources[energyIndex]!.createdAt : createdAt,
    updatedAt,
  };
  if (energyIndex >= 0) {
    snapshot.energySources[energyIndex] = {
      ...snapshot.energySources[energyIndex]!,
      ...energyRecord,
    };
  } else {
    snapshot.energySources.push(energyRecord);
  }

  const offeringIndex = snapshot.offerings.findIndex((item) => item.offeringId === ids.offeringId);
  const offeringRecord: AIOffering = {
    offeringId: ids.offeringId,
    channelId: ids.channelId,
    modelId,
    capabilityId,
    enabled: true,
    recommended: input.recommended === true,
    lastUsedAt: input.lastUsedAt ?? existingMaterialized?.offering.lastUsedAt,
  };
  if (offeringIndex >= 0) {
    snapshot.offerings[offeringIndex] = {
      ...snapshot.offerings[offeringIndex]!,
      ...offeringRecord,
    };
  } else {
    snapshot.offerings.push(offeringRecord);
  }

  if (input.setAsDefault) {
    upsertResolutionRule(snapshot, ids.offeringId);
  }

  snapshot.updatedAt = updatedAt;
  saveAIRegistrySnapshot(snapshot);
  saveAIEnergySecret(ids.energySourceId, {
    apiKey,
    updatedAt,
  });

  const meta = getRegistryProviderProfileMeta(createProfileId(ids.offeringId));
  if (!meta) {
    throw new Error('failed to resolve registry-backed provider profile meta');
  }
  return meta;
}

function materializeProfileMeta(materialized: RegistryOfferingMaterialized): ProviderProfileMeta {
  return {
    profileId: createProfileId(materialized.offering.offeringId),
    name: materialized.energySource?.accountLabel?.trim() || materialized.channel.name,
    provider: toCompatProviderId(materialized.channel.vendor || materialized.model.vendor, materialized.channel.apiHost),
    model: materialized.model.displayName,
    baseUrl: normalizeOptionalText(materialized.channel.apiHost),
    createdAt: materialized.energySource?.createdAt ?? materialized.channel.createdAt,
    updatedAt: maxIso(
      materialized.channel.updatedAt,
      materialized.energySource?.updatedAt,
    ) || DEFAULT_TIMESTAMP,
    lastUsedAt: materialized.offering.lastUsedAt,
  };
}

export function getDefaultLLMRegistryDraft(): RegistryDefaultLLMDraft {
  const resolved = resolveExplicitDefaultLLMOffering();
  if (!resolved) {
    return {
      channelName: DEFAULT_LLM_CHANNEL_NAME,
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
      apiKey: '',
    };
  }

  return {
    channelName: resolved.channel.name,
    baseUrl: resolved.channel.apiHost || DEFAULT_LLM_BASE_URL,
    model: resolved.model.displayName || DEFAULT_LLM_MODEL,
    apiKey: getAIEnergySecret(resolved.energySource?.energySourceId ?? '')?.apiKey ?? '',
  };
}

export function saveDefaultLLMRegistryDraft(input: RegistryDefaultLLMDraft): void {
  const resolved = resolveExplicitDefaultLLMOffering();
  saveRegistryProfileSeed({
    profileId: resolved ? createProfileId(resolved.offering.offeringId) : undefined,
    sourceKey: resolved ? undefined : DEFAULT_LLM_SOURCE_KEY,
    name: input.channelName.trim() || DEFAULT_LLM_CHANNEL_NAME,
    provider: toCompatProviderId(resolved?.channel.vendor ?? 'openai', input.baseUrl),
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    recommended: true,
    setAsDefault: true,
  });
}

export function listRegistryProviderProfiles(): ProviderProfileMeta[] {
  const snapshot = getAIRegistrySnapshot();
  const capabilityId = getLLMChatCapabilityId(snapshot);

  return snapshot.offerings
    .filter((item) => item.enabled && item.capabilityId === capabilityId)
    .map((item) => materializeOffering(snapshot, item))
    .filter((item): item is RegistryOfferingMaterialized => Boolean(item))
    .map((item) => materializeProfileMeta(item))
    .sort((left, right) => {
      const leftRank = left.lastUsedAt ?? left.updatedAt;
      const rightRank = right.lastUsedAt ?? right.updatedAt;
      return rightRank.localeCompare(leftRank);
    });
}

export function getRegistryProviderProfileMeta(profileId: string): ProviderProfileMeta | null {
  const snapshot = getAIRegistrySnapshot();
  const offeringId = parseProfileOfferingId(profileId);
  if (!offeringId) {
    return null;
  }

  const materialized = materializeOffering(
    snapshot,
    snapshot.offerings.find((item) => item.offeringId === offeringId),
  );
  if (!materialized) {
    return null;
  }

  return materializeProfileMeta(materialized);
}

export function getRegistryProviderProfileSecret(profileId: string): ProviderProfileSecret | null {
  const snapshot = getAIRegistrySnapshot();
  const offeringId = parseProfileOfferingId(profileId);
  if (!offeringId) {
    return null;
  }

  const materialized = materializeOffering(
    snapshot,
    snapshot.offerings.find((item) => item.offeringId === offeringId),
  );
  const secret = getAIEnergySecret(materialized?.energySource?.energySourceId ?? '');
  if (!materialized || !secret) {
    return null;
  }

  return {
    profileId,
    apiKey: secret.apiKey,
    updatedAt: secret.updatedAt,
  };
}

export function resolveRegistryProviderProfile(profileId: string): ProviderProfileSnapshot | null {
  const meta = getRegistryProviderProfileMeta(profileId);
  const secret = getRegistryProviderProfileSecret(profileId);
  if (!meta || !secret?.apiKey) {
    return null;
  }

  return {
    ...meta,
    apiKey: secret.apiKey,
  };
}

export function createRegistryProviderProfile(input: CreateProviderProfileInput): ProviderProfileMeta {
  return saveRegistryProfileSeed({
    sourceKey: `provider-profile-${createUuidV4()}`,
    name: input.name,
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    recommended: false,
    setAsDefault: false,
  });
}

export function importRegistryProviderProfile(profile: ProviderProfileSnapshot): ProviderProfileMeta {
  return saveRegistryProfileSeed({
    sourceKey: profile.profileId,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastUsedAt: profile.lastUsedAt,
    recommended: false,
    setAsDefault: false,
  });
}

export function updateRegistryProviderProfile(
  profileId: string,
  input: UpdateProviderProfileInput,
): ProviderProfileMeta | null {
  const current = resolveRegistryProviderProfile(profileId);
  if (!current) {
    return null;
  }

  return saveRegistryProfileSeed({
    profileId,
    name: input.name ? normalizeRequiredText(input.name, 'name') : current.name,
    provider: current.provider,
    model: input.model ? normalizeRequiredText(input.model, 'model') : current.model,
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : current.baseUrl,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : current.apiKey,
    createdAt: current.createdAt,
    lastUsedAt: current.lastUsedAt,
    recommended: false,
    setAsDefault: false,
  });
}

export function markRegistryProviderProfileUsed(profileId: string): ProviderProfileMeta | null {
  const meta = getRegistryProviderProfileMeta(profileId);
  const snapshot = cloneSnapshot();
  const offeringId = parseProfileOfferingId(profileId);
  if (!meta || !offeringId) {
    return null;
  }

  const offeringIndex = snapshot.offerings.findIndex((item) => item.offeringId === offeringId);
  if (offeringIndex < 0) {
    return null;
  }

  const lastUsedAt = nowIso();
  snapshot.offerings[offeringIndex] = {
    ...snapshot.offerings[offeringIndex]!,
    lastUsedAt,
  };
  snapshot.updatedAt = lastUsedAt;
  saveAIRegistrySnapshot(snapshot);

  return {
    ...meta,
    lastUsedAt,
  };
}
