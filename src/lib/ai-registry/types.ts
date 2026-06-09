export type AIChannelType = 'official' | 'proxy' | 'aggregator' | 'self-hosted';
export type AIAuthKind = 'api_key' | 'session' | 'oauth' | 'none';
export type AIModelModality = 'llm' | 'image' | 'video' | 'audio' | 'multimodal' | 'analysis';
export type AIInputKind = 'text' | 'image' | 'video' | 'audio' | 'mixed';
export type AIOutputKind = 'text' | 'image' | 'video' | 'audio' | 'json';
export type AIStabilityLevel = 'unknown' | 'low' | 'medium' | 'high';
export type AILatencyTier = 'unknown' | 'slow' | 'normal' | 'fast';
export type AIBillingUnit = 'per_request' | 'per_1k_tokens' | 'per_minute' | 'per_image' | 'per_video';
export type AIHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down';

export interface AIChannel {
  channelId: string;
  name: string;
  vendor: string;
  channelType: AIChannelType;
  apiHost: string;
  authKind: AIAuthKind;
  region?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AIModel {
  modelId: string;
  canonicalKey: string;
  displayName: string;
  vendor: string;
  family?: string;
  modality: AIModelModality;
  officialName?: string;
  aliases: string[];
  deprecated: boolean;
}

export interface AICapability {
  capabilityId: string;
  key: string;
  displayName: string;
  inputKind: AIInputKind;
  outputKind: AIOutputKind;
  baseParamSchema?: Record<string, unknown>;
  notes?: string;
}

export interface AIPriceRule {
  currency?: string;
  billingUnit?: AIBillingUnit;
  unitPrice?: number;
  notes?: string;
}

export interface AIOffering {
  offeringId: string;
  channelId: string;
  modelId: string;
  capabilityId: string;
  enabled: boolean;
  recommended: boolean;
  lastUsedAt?: string;
  qualityScoreManual?: number;
  stabilityLevelManual?: AIStabilityLevel;
  latencyTierManual?: AILatencyTier;
  priceRule?: AIPriceRule;
  paramSchemaOverride?: Record<string, unknown>;
  notes?: string;
}

export interface AIEnergySource {
  energySourceId: string;
  channelId: string;
  credentialRef?: string;
  accountLabel?: string;
  currency?: string;
  balance?: number;
  quotaLimit?: number;
  quotaRemaining?: number;
  expiresAt?: string;
  healthStatus?: AIHealthStatus;
  successRate?: number;
  errorRate?: number;
  avgLatencyMs?: number;
  lastCheckedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIResolutionRule {
  ruleId: string;
  targetKey: string;
  defaultOfferingId?: string;
  fallbackOfferingIds: string[];
  notes?: string;
}

export interface AIRegistrySnapshot {
  version: 1;
  channels: AIChannel[];
  models: AIModel[];
  capabilities: AICapability[];
  offerings: AIOffering[];
  energySources: AIEnergySource[];
  resolutionRules: AIResolutionRule[];
  updatedAt: string;
}
