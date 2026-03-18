import type { ProviderProfileSnapshot } from '@/lib/agent-provider/types';
import type {
  AICapability,
  AIChannel,
  AIEnergySource,
  AIModel,
  AIOffering,
  AIRegistrySnapshot,
  AIResolutionRule,
} from './types';

export interface LegacyRegistrySources {
  llmSettings?: { apiKey: string; baseUrl: string; model: string };
  providerProfiles: ProviderProfileSnapshot[];
}

interface LegacySourceRecord {
  sourceId: string;
  sourceName: string;
  vendor: string;
  model: string;
  apiHost: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_TIMESTAMP = '2026-03-18T00:00:00.000Z';

const DEFAULT_CAPABILITIES: AICapability[] = [
  {
    capabilityId: 'capability-llm-chat',
    key: 'llm.chat',
    displayName: 'LLM Chat',
    inputKind: 'text',
    outputKind: 'text',
  },
];

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function inferVendor(baseUrl: string, fallbackVendor?: string): string {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes('anthropic')) return 'anthropic';
  if (normalized.includes('openai')) return 'openai';
  return fallbackVendor ?? 'custom';
}

function toLegacySourceRecords(input: LegacyRegistrySources): LegacySourceRecord[] {
  const records: LegacySourceRecord[] = [];

  if (input.llmSettings?.apiKey.trim()) {
    records.push({
      sourceId: 'legacy-llm-settings',
      sourceName: 'Legacy LLM Settings',
      vendor: inferVendor(input.llmSettings.baseUrl, 'openai'),
      model: input.llmSettings.model.trim(),
      apiHost: input.llmSettings.baseUrl.trim(),
      apiKey: input.llmSettings.apiKey.trim(),
      createdAt: DEFAULT_TIMESTAMP,
      updatedAt: DEFAULT_TIMESTAMP,
    });
  }

  for (const profile of input.providerProfiles) {
    records.push({
      sourceId: profile.profileId,
      sourceName: profile.name,
      vendor: profile.provider,
      model: profile.model.trim(),
      apiHost: profile.baseUrl?.trim() || 'https://api.openai.com/v1',
      apiKey: profile.apiKey.trim(),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
  }

  return records;
}

function buildChannel(record: LegacySourceRecord): AIChannel {
  const sourceKey = sanitizeIdPart(record.sourceId || record.apiHost);

  return {
    channelId: `channel-${sourceKey}`,
    name: record.sourceName,
    vendor: record.vendor,
    channelType: record.apiHost.includes('api.openai.com') || record.apiHost.includes('anthropic.com')
      ? 'official'
      : 'proxy',
    apiHost: record.apiHost,
    authKind: 'api_key',
    enabled: true,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildModel(record: LegacySourceRecord): AIModel {
  const canonicalKey = sanitizeIdPart(record.model);

  return {
    modelId: `model-${canonicalKey}`,
    canonicalKey,
    displayName: record.model,
    vendor: record.vendor,
    modality: 'llm',
    aliases: [record.model],
    deprecated: false,
  };
}

function buildOffering(channelId: string, modelId: string): AIOffering {
  return {
    offeringId: `${channelId}-llm-chat`,
    channelId,
    modelId,
    capabilityId: 'capability-llm-chat',
    enabled: true,
    recommended: true,
  };
}

function buildEnergySource(record: LegacySourceRecord, channelId: string): AIEnergySource {
  return {
    energySourceId: `energy-${sanitizeIdPart(record.sourceId)}`,
    channelId,
    accountLabel: record.sourceName,
    credentialRef: `legacy:${record.sourceId}`,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function upsertModel(models: AIModel[], nextModel: AIModel): void {
  if (models.some((item) => item.canonicalKey === nextModel.canonicalKey)) {
    return;
  }

  models.push(nextModel);
}

function buildResolutionRules(offerings: AIOffering[]): AIResolutionRule[] {
  const [firstOffering, ...fallbackOfferings] = offerings;

  return [{
    ruleId: 'rule-llm-chat',
    targetKey: 'llm.chat',
    defaultOfferingId: firstOffering?.offeringId,
    fallbackOfferingIds: fallbackOfferings.map((item) => item.offeringId),
  }];
}

export function buildRegistryFromLegacySources(input: LegacyRegistrySources): AIRegistrySnapshot {
  const records = toLegacySourceRecords(input);
  const channels: AIChannel[] = [];
  const models: AIModel[] = [];
  const offerings: AIOffering[] = [];
  const energySources: AIEnergySource[] = [];

  for (const record of records) {
    const channel = buildChannel(record);
    const model = buildModel(record);
    const offering = buildOffering(channel.channelId, model.modelId);

    channels.push(channel);
    upsertModel(models, model);
    offerings.push(offering);
    energySources.push(buildEnergySource(record, channel.channelId));
  }

  return {
    version: 1,
    channels,
    models,
    capabilities: DEFAULT_CAPABILITIES,
    offerings,
    energySources,
    resolutionRules: buildResolutionRules(offerings),
    updatedAt: records.length > 0 ? records[records.length - 1]!.updatedAt : DEFAULT_TIMESTAMP,
  };
}
