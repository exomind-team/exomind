import type { TiledLayout } from './TiledGrid';

export const AGENTS_TILED_PERSISTENCE_STORAGE_KEY = 'exomind:agentHubTiledState';

export interface TiledPersistState {
  layout: TiledLayout;
  paneOrder: string[];
  fullscreenPtyId?: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const DEFAULT_TILED_PERSIST_STATE: TiledPersistState = {
  layout: '2x2',
  paneOrder: [],
};

const VALID_LAYOUTS = new Set<TiledLayout>(['1x1', '1x2', '2x2', '2x4']);

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function sanitizePersistState(value: unknown): TiledPersistState {
  if (!value || typeof value !== 'object') {
    return DEFAULT_TILED_PERSIST_STATE;
  }

  const candidate = value as Partial<TiledPersistState>;
  const layout = VALID_LAYOUTS.has(candidate.layout as TiledLayout)
    ? candidate.layout as TiledLayout
    : DEFAULT_TILED_PERSIST_STATE.layout;
  const paneOrder = Array.isArray(candidate.paneOrder) ? uniqueIds(candidate.paneOrder) : [];
  const fullscreenPtyId = typeof candidate.fullscreenPtyId === 'string' && candidate.fullscreenPtyId.length > 0
    ? candidate.fullscreenPtyId
    : undefined;

  return {
    layout,
    paneOrder,
    ...(fullscreenPtyId ? { fullscreenPtyId } : {}),
  };
}

export function readAgentsTiledPersistState(storage = getDefaultStorage()): TiledPersistState {
  if (!storage) {
    return DEFAULT_TILED_PERSIST_STATE;
  }

  try {
    const raw = storage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TILED_PERSIST_STATE;
    }
    return sanitizePersistState(JSON.parse(raw));
  } catch {
    return DEFAULT_TILED_PERSIST_STATE;
  }
}

export function writeAgentsTiledPersistState(
  state: TiledPersistState,
  storage = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const sanitized = sanitizePersistState(state);
  const hasMeaningfulState = sanitized.layout !== DEFAULT_TILED_PERSIST_STATE.layout
    || sanitized.paneOrder.length > 0
    || !!sanitized.fullscreenPtyId;

  if (!hasMeaningfulState) {
    storage.removeItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY);
    return;
  }

  storage.setItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY, JSON.stringify(sanitized));
}
