export type ProfileAuthMode = 'none' | 'pin' | 'password' | 'biometric';

export type ProfileState = 'active' | 'archived';

export type DefaultSyncPolicy = 'local-only' | 'manual-link' | 'auto-sync-when-linked';

export interface LocalProfile {
  profileId: string;
  slug: string;
  displayName: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
  authMode: ProfileAuthMode;
  state: ProfileState;
  defaultSyncPolicy: DefaultSyncPolicy;
}

export interface ProfileSecret {
  profileId: string;
  localPasswordHash?: string;
  updatedAt: string;
}

export interface RemoteIdentityRef {
  providerId: string;
  remoteIdentityKey: string;
  displayName?: string;
}

export interface IdentityLink {
  linkId: string;
  profileId: string;
  providerId: string;
  remoteIdentityId: string;
  remoteIdentityKey: string;
  displayName?: string;
  authMode: 'none' | 'basic' | 'token';
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

export interface ProfileSessionState {
  version?: number;
  activeProfileId: string | null;
  unlockedProfileIds: string[];
}

export interface CreateLocalProfileInput {
  slug: string;
  displayName: string;
  localPasswordHash?: string;
  avatar?: string;
  authMode?: ProfileAuthMode;
  defaultSyncPolicy?: DefaultSyncPolicy;
}
