import type { IdentityLink, IdentityLinkSecret } from './types';
import { createUuidV4 } from '@/lib/utils/uuid';

const IDENTITY_LINK_INDEX_KEY = 'exomind:identity-links:index';
const IDENTITY_LINK_META_KEY_PREFIX = 'exomind:identity-links:meta:';
const IDENTITY_LINK_SECRET_KEY_PREFIX = 'exomind:identity-links:secret:';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function getIdentityLinkMetaKey(linkId: string): string {
  return `${IDENTITY_LINK_META_KEY_PREFIX}${linkId}`;
}

function getIdentityLinkSecretKey(linkId: string): string {
  return `${IDENTITY_LINK_SECRET_KEY_PREFIX}${linkId}`;
}

function getIdentityLinkIndex(): string[] {
  return readJson<string[]>(IDENTITY_LINK_INDEX_KEY, []);
}

function setIdentityLinkIndex(linkIds: string[]): void {
  writeJson(IDENTITY_LINK_INDEX_KEY, linkIds);
}

export function getIdentityLink(linkId: string): IdentityLink | null {
  return readJson<IdentityLink | null>(getIdentityLinkMetaKey(linkId), null);
}

export function getIdentityLinkSecret(linkId: string): IdentityLinkSecret | null {
  return readJson<IdentityLinkSecret | null>(getIdentityLinkSecretKey(linkId), null);
}

export function listIdentityLinks(profileId?: string): IdentityLink[] {
  const links = getIdentityLinkIndex()
    .map((linkId) => getIdentityLink(linkId))
    .filter((link): link is IdentityLink => Boolean(link));

  return profileId ? links.filter((link) => link.profileId === profileId) : links;
}

export function createIdentityLink(input: {
  profileId: string;
  providerId: string;
  remoteIdentityId: string;
  remoteIdentityKey: string;
  displayName?: string;
  authType?: 'none' | 'basic' | 'token';
  authUsername?: string;
  authSecret?: string;
  syncMode?: 'disabled' | 'manual' | 'realtime';
}): IdentityLink {
  const now = new Date().toISOString();
  const linkId = `link_${createUuidV4()}`;
  const link: IdentityLink = {
    linkId,
    profileId: input.profileId,
    providerId: input.providerId,
    remoteIdentityId: input.remoteIdentityId,
    remoteIdentityKey: input.remoteIdentityKey,
    displayName: input.displayName,
    authMode: input.authType ?? 'none',
    status: 'linked',
    syncMode: input.syncMode ?? 'realtime',
    linkedAt: now,
  };

  const index = getIdentityLinkIndex();
  setIdentityLinkIndex([...index, linkId]);
  writeJson(getIdentityLinkMetaKey(linkId), link);

  if (input.authType && input.authType !== 'none') {
    const secret: IdentityLinkSecret = {
      linkId,
      authType: input.authType,
      authUsername: input.authUsername,
      authSecret: input.authSecret,
      updatedAt: now,
    };
    writeJson(getIdentityLinkSecretKey(linkId), secret);
  }

  return link;
}

export function revokeIdentityLink(linkId: string): void {
  const link = getIdentityLink(linkId);
  if (!link) {
    return;
  }

  writeJson(getIdentityLinkMetaKey(linkId), {
    ...link,
    status: 'revoked',
  } satisfies IdentityLink);
  localStorage.removeItem(getIdentityLinkSecretKey(linkId));
}

