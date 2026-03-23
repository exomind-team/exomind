export type ApiProviderId = 'openai' | 'anthropic';

export interface ProviderProfileMeta {
  profileId: string;
  name: string;
  provider: ApiProviderId;
  model: string;
  baseUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface ProviderProfileSecret {
  profileId: string;
  apiKey: string;
  updatedAt: string;
}

export interface ProviderProfileSnapshot extends ProviderProfileMeta {
  apiKey: string;
}

export interface CreateProviderProfileInput {
  name: string;
  provider: ApiProviderId;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

export interface UpdateProviderProfileInput {
  name?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}
