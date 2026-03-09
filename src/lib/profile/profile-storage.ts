import type {
  CreateLocalProfileInput,
  LocalProfile,
  ProfileSecret,
  ProfileSessionState,
} from './types';

const PROFILE_INDEX_KEY = 'exomind:profiles:index';
const PROFILE_SESSION_KEY = 'exomind:profile-session';
const LEGACY_USERS_KEY = 'exomind:users';
const LEGACY_SYNC_STORE_KEY = 'exomind:sync-store';
const LEGACY_LOGIN_ALIAS_KEY = 'exomind:profiles:legacy-login-aliases';

function getProfileMetaKey(profileId: string): string {
  return `exomind:profiles:${profileId}:meta`;
}

function getProfileSecretKey(profileId: string): string {
  return `exomind:profiles:${profileId}:secret`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function getLegacyLoginAliases(): Record<string, string> {
  return readJson<Record<string, string>>(LEGACY_LOGIN_ALIAS_KEY, {});
}

function setLegacyLoginAliases(aliases: Record<string, string>): void {
  writeJson(LEGACY_LOGIN_ALIAS_KEY, aliases);
}

function findLegacyAliasedProfile(loginName: string): LocalProfile | null {
  const exactAlias = getLegacyLoginAliases()[loginName.trim()];
  if (!exactAlias) {
    return null;
  }

  return getLocalProfile(exactAlias);
}

function findProfileByExactDisplayName(displayName: string): LocalProfile | null {
  const target = displayName.trim();
  if (!target) {
    return null;
  }

  return listLocalProfiles().find((profile) => profile.displayName === target) || null;
}

function rememberLegacyLoginAlias(loginName: string, profileId: string): void {
  const normalized = loginName.trim();
  if (!normalized) {
    return;
  }

  const aliases = getLegacyLoginAliases();
  if (aliases[normalized] === profileId) {
    return;
  }

  aliases[normalized] = profileId;
  setLegacyLoginAliases(aliases);
}

export function normalizeProfileSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createProfileIdBase(slug: string): string {
  const normalized = normalizeProfileSlug(slug);
  return `profile-${normalized || 'default'}`;
}

function getProfileIndex(): string[] {
  return readJson<string[]>(PROFILE_INDEX_KEY, []);
}

function setProfileIndex(profileIds: string[]): void {
  writeJson(PROFILE_INDEX_KEY, profileIds);
}

export function getProfileSession(): ProfileSessionState {
  return readJson<ProfileSessionState>(PROFILE_SESSION_KEY, {
    version: 1,
    activeProfileId: null,
    unlockedProfileIds: [],
  });
}

export function setProfileSession(session: ProfileSessionState): void {
  writeJson(PROFILE_SESSION_KEY, session);
}

function ensureUniqueProfileId(slug: string): string {
  const index = getProfileIndex();
  const base = createProfileIdBase(slug);
  if (!index.includes(base)) {
    return base;
  }

  let suffix = 2;
  while (index.includes(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function resolveAvailableProfileSlug(rawSlug: string): string {
  const base = normalizeProfileSlug(rawSlug);
  if (!base) {
    return '';
  }

  if (!findProfileBySlug(base)) {
    return base;
  }

  let suffix = 2;
  while (findProfileBySlug(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export function listLocalProfiles(): LocalProfile[] {
  return getProfileIndex()
    .map((profileId) => getLocalProfile(profileId))
    .filter((profile): profile is LocalProfile => Boolean(profile));
}

export function getLocalProfile(profileId: string): LocalProfile | null {
  return readJson<LocalProfile | null>(getProfileMetaKey(profileId), null);
}

export function getProfileSecret(profileId: string): ProfileSecret | null {
  return readJson<ProfileSecret | null>(getProfileSecretKey(profileId), null);
}

export function getActiveProfileId(): string | null {
  return getProfileSession().activeProfileId;
}

export function setActiveProfileId(profileId: string | null): void {
  const session = getProfileSession();
  setProfileSession({
    ...session,
    activeProfileId: profileId,
    unlockedProfileIds: profileId
      ? Array.from(new Set([...session.unlockedProfileIds, profileId]))
      : session.unlockedProfileIds,
  });
}

export function getActiveProfile(): LocalProfile | null {
  const activeProfileId = getActiveProfileId();
  return activeProfileId ? getLocalProfile(activeProfileId) : null;
}

export function findProfileBySlug(slug: string): LocalProfile | null {
  const target = normalizeProfileSlug(slug);
  if (!target) {
    return null;
  }

  return listLocalProfiles().find((profile) => profile.slug.toLowerCase() === target) || null;
}

export function findProfileByLoginName(loginName: string): LocalProfile | null {
  const aliasedProfile = findLegacyAliasedProfile(loginName);
  if (aliasedProfile) {
    return aliasedProfile;
  }

  return findProfileBySlug(loginName);
}

export function createLocalProfile(input: CreateLocalProfileInput): LocalProfile {
  const slug = normalizeProfileSlug(input.slug);
  if (!slug) {
    throw new Error('档案标识不能为空');
  }
  if (findProfileBySlug(slug)) {
    throw new Error('档案标识已存在');
  }

  const now = new Date().toISOString();
  const profileId = ensureUniqueProfileId(slug);
  const profile: LocalProfile = {
    profileId,
    slug,
    displayName: input.displayName.trim() || slug,
    avatar: input.avatar,
    createdAt: now,
    updatedAt: now,
    authMode: input.authMode ?? (input.localPasswordHash ? 'password' : 'none'),
    state: 'active',
    defaultSyncPolicy: input.defaultSyncPolicy ?? 'local-only',
  };

  const index = getProfileIndex();
  setProfileIndex([...index, profileId]);
  writeJson(getProfileMetaKey(profileId), profile);

  if (input.localPasswordHash) {
    const secret: ProfileSecret = {
      profileId,
      localPasswordHash: input.localPasswordHash,
      updatedAt: now,
    };
    writeJson(getProfileSecretKey(profileId), secret);
  }

  return profile;
}

type LegacyUserRecord = {
  username: string;
  passwordHash: string;
  createdAt?: string;
  lastLogin?: string;
};

function getLegacyActiveUser(): string | null {
  const parsed = readJson<{ state?: { currentUser?: string }; currentUser?: string } | null>(LEGACY_SYNC_STORE_KEY, null);
  return parsed?.state?.currentUser || parsed?.currentUser || null;
}

export function migrateLegacyProfileStorage(): void {
  const legacyUsers = readJson<LegacyUserRecord[]>(LEGACY_USERS_KEY, []);
  if (!Array.isArray(legacyUsers) || legacyUsers.length === 0) {
    return;
  }

  for (const legacyUser of legacyUsers) {
    const existing =
      findLegacyAliasedProfile(legacyUser.username) ??
      findProfileByExactDisplayName(legacyUser.username);

    if (existing) {
      rememberLegacyLoginAlias(legacyUser.username, existing.profileId);
      if (legacyUser.passwordHash && !getProfileSecret(existing.profileId)?.localPasswordHash) {
        writeJson(getProfileSecretKey(existing.profileId), {
          profileId: existing.profileId,
          localPasswordHash: legacyUser.passwordHash,
          updatedAt: legacyUser.lastLogin || legacyUser.createdAt || new Date().toISOString(),
        } satisfies ProfileSecret);
      }
      continue;
    }

    const profile = createLocalProfile({
      slug: resolveAvailableProfileSlug(legacyUser.username),
      displayName: legacyUser.username,
      localPasswordHash: legacyUser.passwordHash,
    });

    const storedProfile = getLocalProfile(profile.profileId);
    if (storedProfile && legacyUser.createdAt) {
      writeJson(getProfileMetaKey(profile.profileId), {
        ...storedProfile,
        createdAt: legacyUser.createdAt,
        updatedAt: legacyUser.lastLogin || legacyUser.createdAt,
      } satisfies LocalProfile);
    }

    rememberLegacyLoginAlias(legacyUser.username, profile.profileId);
  }

  const legacyActiveUser = getLegacyActiveUser();
  if (legacyActiveUser) {
    const activeProfile = findProfileByLoginName(legacyActiveUser);
    if (activeProfile) {
      setActiveProfileId(activeProfile.profileId);
    }
  }
}

export function ensureProfileStorageMigrated(): void {
  migrateLegacyProfileStorage();

  const session = getProfileSession();
  if (typeof session.version !== 'number') {
    setProfileSession({
      version: 1,
      activeProfileId: session.activeProfileId ?? null,
      unlockedProfileIds: Array.isArray(session.unlockedProfileIds) ? session.unlockedProfileIds : [],
    });
  }
}

export function getCurrentProfileOrLegacyId(): string {
  const activeProfile = getActiveProfile();
  if (activeProfile) {
    return activeProfile.profileId;
  }

  return getLegacyActiveUser() || 'anonymous';
}
