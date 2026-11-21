import type { BetaProfile } from './client';

const MIN_ID_PREFIX_LENGTH = 8;

export interface BetaProfileLabel {
  displayName: string;
  identity: string | null;
  text: string;
}

function shortestDistinctPrefixes(profiles: readonly BetaProfile[]): Map<string, string> {
  const identifiers = profiles.map(profile => profile.profile_id);
  const maxLength = Math.max(...identifiers.map(identifier => identifier.length));
  const start = Math.min(MIN_ID_PREFIX_LENGTH, maxLength);

  for (let length = start; length <= maxLength; length += 1) {
    const prefixes = identifiers.map(identifier => identifier.slice(0, length));
    if (new Set(prefixes).size === identifiers.length) {
      return new Map(identifiers.map((identifier, index) => [identifier, prefixes[index]]));
    }
  }

  return new Map(identifiers.map(identifier => [identifier, identifier]));
}

/**
 * Keep unique names untouched. Only visually identical names receive a stable
 * identity suffix; the persistent name and profile ID remain unchanged.
 */
export function betaProfileLabels(profiles: readonly BetaProfile[]): Map<string, BetaProfileLabel> {
  const groups = new Map<string, BetaProfile[]>();
  for (const profile of profiles) {
    const displayName = profile.display_name.trim() || profile.profile_id.slice(0, MIN_ID_PREFIX_LENGTH);
    const group = groups.get(displayName) ?? [];
    group.push(profile);
    groups.set(displayName, group);
  }

  const labels = new Map<string, BetaProfileLabel>();
  for (const [displayName, group] of groups) {
    const identities = group.length > 1
      ? shortestDistinctPrefixes(group)
      : new Map(group.map(profile => [profile.profile_id, null]));
    for (const profile of group) {
      const identity = identities.get(profile.profile_id) ?? null;
      labels.set(profile.profile_id, {
        displayName,
        identity,
        // The compact select may truncate from the end; keep the distinguishing
        // identity first so a narrow layout cannot remove it.
        text: identity ? `${identity} · ${displayName}` : displayName,
      });
    }
  }
  return labels;
}
