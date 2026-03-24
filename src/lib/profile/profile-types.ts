export type LocalProfileAuthMode = 'none' | 'pin' | 'password' | 'biometric';

export type LocalProfileState = 'active' | 'archived';

export type LocalProfileSyncPolicy = 'local-only' | 'manual-link' | 'auto-sync-when-linked';

export interface LocalProfile {
  profileId: string;
  slug: string;
  displayName: string;
  storageKey: string;
  createdAt: string;
  updatedAt: string;
  authMode: LocalProfileAuthMode;
  state: LocalProfileState;
  defaultSyncPolicy: LocalProfileSyncPolicy;
}

export interface ProfileSecret {
  profileId: string;
  localPasswordHash?: string;
  updatedAt: string;
}

export interface IdentityLink {
  linkId: string;
  profileId: string;
  providerId: string;
  remoteIdentityId: string;
  remoteIdentityKey: string;
  displayName?: string;
  status: 'linked' | 'expired' | 'revoked';
  syncMode: 'disabled' | 'manual' | 'realtime';
  linkedAt: string;
  lastVerifiedAt?: string;
}

export interface IdentityLinkSecret {
  linkId: string;
  authType: 'none' | 'basic' | 'token';
  authUsername?: string;
  authSecret?: string;
  updatedAt: string;
}

export interface ProfileIndex {
  version: 1;
  migratedFromLegacy: boolean;
  profileIds: string[];
}

export interface ProfileSession {
  version: 1;
  activeProfileId: string | null;
  unlockedProfileIds: string[];
}

