import {
  AGENT_HUB_VIEW_MODES,
  type AgentHubViewMode,
} from '@/lib/types/agent-hub';

export const AGENTS_VIEW_PERSISTENCE_STORAGE_KEY = 'exomind:agentHubViewMode';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const DEFAULT_AGENT_HUB_VIEW_MODE: AgentHubViewMode = 'topology';
const VALID_VIEW_MODES = new Set<AgentHubViewMode>(AGENT_HUB_VIEW_MODES);

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

export function sanitizeAgentHubViewMode(value: unknown): AgentHubViewMode {
  return typeof value === 'string' && VALID_VIEW_MODES.has(value as AgentHubViewMode)
    ? value as AgentHubViewMode
    : DEFAULT_AGENT_HUB_VIEW_MODE;
}

export function readAgentsViewModeFromLocationSearch(search: string | null | undefined): AgentHubViewMode | null {
  if (!search) {
    return null;
  }

  try {
    const raw = new URLSearchParams(search).get('view');
    if (!raw) {
      return null;
    }

    const sanitized = sanitizeAgentHubViewMode(raw);
    return sanitized === raw ? sanitized : null;
  } catch {
    return null;
  }
}

export function readAgentsViewModePersistState(storage = getDefaultStorage()): AgentHubViewMode {
  if (!storage) {
    return DEFAULT_AGENT_HUB_VIEW_MODE;
  }

  try {
    const raw = storage.getItem(AGENTS_VIEW_PERSISTENCE_STORAGE_KEY);
    return sanitizeAgentHubViewMode(raw);
  } catch {
    return DEFAULT_AGENT_HUB_VIEW_MODE;
  }
}

export function writeAgentsViewModePersistState(
  viewMode: AgentHubViewMode,
  storage = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const sanitized = sanitizeAgentHubViewMode(viewMode);
  if (sanitized === DEFAULT_AGENT_HUB_VIEW_MODE) {
    storage.removeItem(AGENTS_VIEW_PERSISTENCE_STORAGE_KEY);
    return;
  }

  storage.setItem(AGENTS_VIEW_PERSISTENCE_STORAGE_KEY, sanitized);
}
