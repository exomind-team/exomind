import type { RecoverableTerminalSessionSnapshot } from './pty-session-recovery';
import type { TiledLayout } from './tiled-layout';
import {
  createTemplatePaneSlotBindings,
  createTemplatePaneTree,
  flattenTiledPaneTreeSlotIds,
  normalizeTiledPaneSlotBindings,
  resolveLegacyPaneOrderFromTree,
  sanitizeTiledPaneTree,
  type TiledPaneSlotBinding,
  type TiledPaneTreeNode,
} from './tiled-pane-tree';
import { VALID_TILED_LAYOUTS } from './tiled-layout';

export const AGENTS_TILED_PERSISTENCE_STORAGE_KEY = 'exomind:agentHubTiledState';
export const DEFAULT_TILED_NAMED_LAYOUT_ID = 'layout-default';
export const DEFAULT_TILED_NAMED_LAYOUT_NAME = '默认布局';
export const DEFAULT_TILED_WORKBENCH_LAYOUT_ID = DEFAULT_TILED_NAMED_LAYOUT_ID;
export const DEFAULT_TILED_WORKBENCH_LAYOUT_NAME = DEFAULT_TILED_NAMED_LAYOUT_NAME;

export interface TiledLayoutPersistSnapshot {
  version: 2;
  layout: TiledLayout;
  paneOrder: string[];
  tree: TiledPaneTreeNode;
  slots: TiledPaneSlotBinding[];
  focusedSlotId?: string;
  unassignedSessionIds: string[];
  unassignedPoolCollapsed: boolean;
  immersive: boolean;
}

export interface TiledPersistState extends TiledLayoutPersistSnapshot {
  fullscreenPtyId?: string;
  fullscreenTerminalRecovery?: RecoverableTerminalSessionSnapshot;
}

export interface NamedTiledWorkbenchLayoutRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  snapshot: TiledLayoutPersistSnapshot;
}

export interface TiledWorkbenchPersistState {
  version: 3;
  activeLayoutId: string;
  layoutOrder: string[];
  layouts: Record<string, NamedTiledWorkbenchLayoutRecord>;
  fullscreenPtyId?: string;
  fullscreenTerminalRecovery?: RecoverableTerminalSessionSnapshot;
}

interface TiledWorkbenchLayoutRecordInput {
  id?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
  snapshot: TiledLayoutPersistSnapshot | TiledPersistState;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

const DEFAULT_TILED_LAYOUT_SNAPSHOT: TiledLayoutPersistSnapshot = {
  version: 2,
  layout: '2x2',
  paneOrder: [],
  tree: createTemplatePaneTree('2x2'),
  slots: createTemplatePaneSlotBindings('2x2'),
  unassignedSessionIds: [],
  unassignedPoolCollapsed: false,
  immersive: false,
};

function createDefaultWorkbenchState(): TiledWorkbenchPersistState {
  return {
    version: 3,
    activeLayoutId: DEFAULT_TILED_NAMED_LAYOUT_ID,
    layoutOrder: [DEFAULT_TILED_NAMED_LAYOUT_ID],
    layouts: {
      [DEFAULT_TILED_NAMED_LAYOUT_ID]: {
        id: DEFAULT_TILED_NAMED_LAYOUT_ID,
        name: DEFAULT_TILED_NAMED_LAYOUT_NAME,
        createdAt: DEFAULT_TIMESTAMP,
        updatedAt: DEFAULT_TIMESTAMP,
        lastUsedAt: DEFAULT_TIMESTAMP,
        snapshot: DEFAULT_TILED_LAYOUT_SNAPSHOT,
      },
    },
  };
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function sanitizeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function sanitizeLayoutName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeLayoutRecordId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeFullscreenTerminalRecovery(
  value: unknown,
): RecoverableTerminalSessionSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<RecoverableTerminalSessionSnapshot>;
  const agentType = candidate.agentType === 'claude' || candidate.agentType === 'codex'
    ? candidate.agentType
    : null;
  const innerSessionId = typeof candidate.innerSessionId === 'string' && candidate.innerSessionId.trim().length > 0
    ? candidate.innerSessionId.trim()
    : null;
  const workdir = typeof candidate.workdir === 'string' && candidate.workdir.trim().length > 0
    ? candidate.workdir.trim()
    : null;
  const projectPathKey = typeof candidate.projectPathKey === 'string' && candidate.projectPathKey.trim().length > 0
    ? candidate.projectPathKey.trim()
    : null;

  if (!agentType || !innerSessionId || !workdir || !projectPathKey) {
    return undefined;
  }

  return {
    ...(typeof candidate.sessionId === 'string' && candidate.sessionId.trim().length > 0
      ? { sessionId: candidate.sessionId.trim() }
      : {}),
    ...(typeof candidate.sourceHostId === 'string' && candidate.sourceHostId.trim().length > 0
      ? { sourceHostId: candidate.sourceHostId.trim() }
      : {}),
    agentType,
    innerSessionId,
    ...(typeof candidate.role === 'string' && candidate.role.trim().length > 0
      ? { role: candidate.role.trim() }
      : {}),
    workdir,
    projectPathKey,
  };
}

function sanitizeLayoutPersistSnapshot(value: unknown): TiledLayoutPersistSnapshot {
  if (!value || typeof value !== 'object') {
    return DEFAULT_TILED_LAYOUT_SNAPSHOT;
  }

  const candidate = value as Partial<TiledLayoutPersistSnapshot>;
  const layout = VALID_TILED_LAYOUTS.has(candidate.layout as TiledLayout)
    ? candidate.layout as TiledLayout
    : DEFAULT_TILED_LAYOUT_SNAPSHOT.layout;
  const legacyPaneOrder = Array.isArray(candidate.paneOrder) ? uniqueIds(candidate.paneOrder) : [];
  const fallbackTree = createTemplatePaneTree(layout);
  const tree = (() => {
    const sanitized = sanitizeTiledPaneTree(candidate.tree);
    if (!sanitized) {
      return fallbackTree;
    }
    const slotIds = flattenTiledPaneTreeSlotIds(sanitized);
    return slotIds.length > 0 && slotIds.length === new Set(slotIds).size
      ? sanitized
      : fallbackTree;
  })();
  const fallbackSlots = createTemplatePaneSlotBindings(layout, legacyPaneOrder);
  const slots = normalizeTiledPaneSlotBindings(tree, candidate.slots ?? fallbackSlots);
  const paneOrder = resolveLegacyPaneOrderFromTree(tree, slots);
  const focusedSlotId = typeof candidate.focusedSlotId === 'string'
    && flattenTiledPaneTreeSlotIds(tree).includes(candidate.focusedSlotId)
    ? candidate.focusedSlotId
    : undefined;

  return {
    version: 2,
    layout,
    paneOrder,
    tree,
    slots,
    ...(focusedSlotId ? { focusedSlotId } : {}),
    unassignedSessionIds: Array.isArray(candidate.unassignedSessionIds)
      ? uniqueIds(candidate.unassignedSessionIds)
      : [],
    unassignedPoolCollapsed: candidate.unassignedPoolCollapsed === true,
    immersive: candidate.immersive === true,
  };
}

function sanitizePersistState(value: unknown): TiledPersistState {
  const snapshot = sanitizeLayoutPersistSnapshot(value);
  const candidate = value && typeof value === 'object'
    ? value as Partial<TiledPersistState>
    : {};
  const fullscreenPtyId = typeof candidate.fullscreenPtyId === 'string' && candidate.fullscreenPtyId.trim().length > 0
    ? candidate.fullscreenPtyId.trim()
    : undefined;
  const fullscreenTerminalRecovery = sanitizeFullscreenTerminalRecovery(
    candidate.fullscreenTerminalRecovery,
  );

  return {
    ...snapshot,
    ...(fullscreenPtyId ? { fullscreenPtyId } : {}),
    ...(fullscreenTerminalRecovery ? { fullscreenTerminalRecovery } : {}),
  };
}

function sanitizeNamedLayoutRecord(
  layoutId: string,
  value: unknown,
): NamedTiledWorkbenchLayoutRecord {
  const candidate = value && typeof value === 'object'
    ? value as Partial<NamedTiledWorkbenchLayoutRecord>
    : {};
  const fallbackName = layoutId === DEFAULT_TILED_NAMED_LAYOUT_ID
    ? DEFAULT_TILED_NAMED_LAYOUT_NAME
    : '未命名布局';

  return {
    id: sanitizeLayoutRecordId(candidate.id, layoutId),
    name: sanitizeLayoutName(candidate.name, fallbackName),
    createdAt: sanitizeIsoTimestamp(candidate.createdAt, DEFAULT_TIMESTAMP),
    updatedAt: sanitizeIsoTimestamp(candidate.updatedAt, DEFAULT_TIMESTAMP),
    lastUsedAt: sanitizeIsoTimestamp(candidate.lastUsedAt, DEFAULT_TIMESTAMP),
    snapshot: sanitizeLayoutPersistSnapshot(candidate.snapshot),
  };
}

function hasMeaningfulSnapshot(snapshot: TiledLayoutPersistSnapshot): boolean {
  return snapshot.layout !== DEFAULT_TILED_LAYOUT_SNAPSHOT.layout
    || snapshot.paneOrder.length > 0
    || JSON.stringify(snapshot.tree) !== JSON.stringify(DEFAULT_TILED_LAYOUT_SNAPSHOT.tree)
    || snapshot.slots.some((slot) => slot.sessionId || slot.terminalRecovery)
    || !!snapshot.focusedSlotId
    || snapshot.unassignedSessionIds.length > 0
    || snapshot.unassignedPoolCollapsed
    || snapshot.immersive;
}

function hasMeaningfulWorkbenchState(state: TiledWorkbenchPersistState): boolean {
  if (state.layoutOrder.length !== 1) {
    return true;
  }

  const onlyLayoutId = state.layoutOrder[0];
  const onlyLayout = state.layouts[onlyLayoutId];
  if (!onlyLayout) {
    return false;
  }

  return state.activeLayoutId !== DEFAULT_TILED_NAMED_LAYOUT_ID
    || onlyLayoutId !== DEFAULT_TILED_NAMED_LAYOUT_ID
    || onlyLayout.name !== DEFAULT_TILED_NAMED_LAYOUT_NAME
    || hasMeaningfulSnapshot(onlyLayout.snapshot)
    || !!state.fullscreenPtyId
    || !!state.fullscreenTerminalRecovery;
}

function buildGeneratedLayoutId(): string {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultTiledWorkbenchLayoutRecord(): NamedTiledWorkbenchLayoutRecord {
  return {
    id: DEFAULT_TILED_NAMED_LAYOUT_ID,
    name: DEFAULT_TILED_NAMED_LAYOUT_NAME,
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    lastUsedAt: DEFAULT_TIMESTAMP,
    snapshot: cloneTiledLayoutPersistSnapshot(DEFAULT_TILED_LAYOUT_SNAPSHOT),
  };
}

function isTiledWorkbenchLayoutRecordInput(
  value: TiledLayoutPersistSnapshot | TiledWorkbenchLayoutRecordInput,
): value is TiledWorkbenchLayoutRecordInput {
  return typeof value === 'object' && value !== null && 'snapshot' in value;
}

export function cloneTiledLayoutPersistSnapshot(
  snapshot: TiledLayoutPersistSnapshot,
): TiledLayoutPersistSnapshot {
  return sanitizeLayoutPersistSnapshot(snapshot);
}

export function normalizeTiledPersistState(
  state: TiledPersistState | TiledLayoutPersistSnapshot,
): TiledPersistState {
  return sanitizePersistState(state);
}

export function extractTiledLayoutPersistSnapshot(
  snapshot: TiledLayoutPersistSnapshot | TiledPersistState,
): TiledLayoutPersistSnapshot {
  return sanitizeLayoutPersistSnapshot(snapshot);
}

export function createEmptyTiledLayoutPersistSnapshot(
  layout: TiledLayout,
  unassignedSessionIds: string[] = [],
): TiledLayoutPersistSnapshot {
  return {
    version: 2,
    layout,
    paneOrder: [],
    tree: createTemplatePaneTree(layout),
    slots: createTemplatePaneSlotBindings(layout),
    unassignedSessionIds: uniqueIds(unassignedSessionIds),
    unassignedPoolCollapsed: false,
    immersive: false,
  };
}

export function createTiledWorkbenchLayoutRecord(
  snapshot: TiledLayoutPersistSnapshot,
  options?: {
    id?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
    lastUsedAt?: string;
  },
): NamedTiledWorkbenchLayoutRecord;
export function createTiledWorkbenchLayoutRecord(
  input: TiledWorkbenchLayoutRecordInput,
): NamedTiledWorkbenchLayoutRecord;
export function createTiledWorkbenchLayoutRecord(
  snapshotOrInput: TiledLayoutPersistSnapshot | TiledWorkbenchLayoutRecordInput,
  options: {
    id?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
    lastUsedAt?: string;
  } = {},
): NamedTiledWorkbenchLayoutRecord {
  const input = isTiledWorkbenchLayoutRecordInput(snapshotOrInput)
    ? snapshotOrInput
    : { ...options, snapshot: snapshotOrInput };
  const createdAt = sanitizeIsoTimestamp(input.createdAt, new Date().toISOString());
  const updatedAt = sanitizeIsoTimestamp(input.updatedAt, createdAt);
  const lastUsedAt = sanitizeIsoTimestamp(input.lastUsedAt, updatedAt);
  const id = sanitizeLayoutRecordId(input.id, buildGeneratedLayoutId());
  const name = sanitizeLayoutName(input.name, buildNextTiledWorkbenchLayoutName({}));

  return {
    id,
    name,
    createdAt,
    updatedAt,
    lastUsedAt,
    snapshot: extractTiledLayoutPersistSnapshot(input.snapshot),
  };
}

export function buildNextTiledWorkbenchLayoutName(
  layouts: Record<string, Pick<NamedTiledWorkbenchLayoutRecord, 'name'>>,
  preferredBaseName: string = '新布局',
): string {
  const baseName = sanitizeLayoutName(preferredBaseName, '新布局');
  const existingNames = new Set(
    Object.values(layouts).map((layout) => sanitizeLayoutName(layout.name, '')),
  );

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

export function readAgentsTiledWorkbenchPersistState(
  storage = getDefaultStorage(),
): TiledWorkbenchPersistState {
  if (!storage) {
    return createDefaultWorkbenchState();
  }

  try {
    const raw = storage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY);
    if (!raw) {
      return createDefaultWorkbenchState();
    }

    const parsed = JSON.parse(raw) as Partial<TiledWorkbenchPersistState>;
    const rawLayouts = parsed.layouts;
    if (!rawLayouts || typeof rawLayouts !== 'object' || Array.isArray(rawLayouts)) {
      const migratedState = sanitizePersistState(parsed);
      return {
        version: 3,
        activeLayoutId: DEFAULT_TILED_NAMED_LAYOUT_ID,
        layoutOrder: [DEFAULT_TILED_NAMED_LAYOUT_ID],
        layouts: {
          [DEFAULT_TILED_NAMED_LAYOUT_ID]: {
            id: DEFAULT_TILED_NAMED_LAYOUT_ID,
            name: DEFAULT_TILED_NAMED_LAYOUT_NAME,
            createdAt: DEFAULT_TIMESTAMP,
            updatedAt: DEFAULT_TIMESTAMP,
            lastUsedAt: DEFAULT_TIMESTAMP,
            snapshot: extractTiledLayoutPersistSnapshot(migratedState),
          },
        },
        ...(migratedState.fullscreenPtyId ? { fullscreenPtyId: migratedState.fullscreenPtyId } : {}),
        ...(migratedState.fullscreenTerminalRecovery ? { fullscreenTerminalRecovery: migratedState.fullscreenTerminalRecovery } : {}),
      };
    }

    const nextLayouts: Record<string, NamedTiledWorkbenchLayoutRecord> = {};
    Object.entries(rawLayouts).forEach(([layoutId, rawLayout]) => {
      const trimmedLayoutId = sanitizeLayoutRecordId(layoutId, '');
      if (!trimmedLayoutId) {
        return;
      }
      nextLayouts[trimmedLayoutId] = sanitizeNamedLayoutRecord(trimmedLayoutId, rawLayout);
    });

    if (Object.keys(nextLayouts).length === 0) {
      return createDefaultWorkbenchState();
    }

    const requestedOrder = Array.isArray(parsed.layoutOrder) ? uniqueIds(parsed.layoutOrder) : [];
    const layoutOrder = [
      ...requestedOrder.filter((layoutId) => layoutId in nextLayouts),
      ...Object.keys(nextLayouts).filter((layoutId) => !requestedOrder.includes(layoutId)),
    ];

    const fallbackLayoutId = layoutOrder[0] ?? Object.keys(nextLayouts)[0] ?? DEFAULT_TILED_NAMED_LAYOUT_ID;
    const activeLayoutId = typeof parsed.activeLayoutId === 'string' && parsed.activeLayoutId in nextLayouts
      ? parsed.activeLayoutId
      : fallbackLayoutId;
    const fullscreenPtyId = typeof parsed.fullscreenPtyId === 'string' && parsed.fullscreenPtyId.trim().length > 0
      ? parsed.fullscreenPtyId.trim()
      : undefined;
    const fullscreenTerminalRecovery = sanitizeFullscreenTerminalRecovery(
      parsed.fullscreenTerminalRecovery,
    );

    return {
      version: 3,
      activeLayoutId,
      layoutOrder: layoutOrder.length > 0 ? layoutOrder : [activeLayoutId],
      layouts: nextLayouts,
      ...(fullscreenPtyId ? { fullscreenPtyId } : {}),
      ...(fullscreenTerminalRecovery ? { fullscreenTerminalRecovery } : {}),
    };
  } catch {
    return createDefaultWorkbenchState();
  }
}

export function resolveActiveTiledWorkbenchLayout(
  state: TiledWorkbenchPersistState,
): NamedTiledWorkbenchLayoutRecord {
  const activeLayout = state.layouts[state.activeLayoutId];
  if (activeLayout) {
    return sanitizeNamedLayoutRecord(activeLayout.id, activeLayout);
  }

  const fallbackLayoutId = state.layoutOrder.find((layoutId) => layoutId in state.layouts);
  if (fallbackLayoutId) {
    return sanitizeNamedLayoutRecord(fallbackLayoutId, state.layouts[fallbackLayoutId]);
  }

  return createDefaultTiledWorkbenchLayoutRecord();
}

export function writeAgentsTiledWorkbenchPersistState(
  state: TiledWorkbenchPersistState,
  storage = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const sanitized = readAgentsTiledWorkbenchPersistState({
    getItem: () => JSON.stringify(state),
    setItem: () => {},
    removeItem: () => {},
  });

  if (!hasMeaningfulWorkbenchState(sanitized)) {
    storage.removeItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY);
    return;
  }

  storage.setItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY, JSON.stringify(sanitized));
}

export function readAgentsTiledPersistState(
  storage = getDefaultStorage(),
): TiledPersistState {
  const workbenchState = readAgentsTiledWorkbenchPersistState(storage);
  const activeLayout = workbenchState.layouts[workbenchState.activeLayoutId];
  const snapshot = activeLayout?.snapshot ?? DEFAULT_TILED_LAYOUT_SNAPSHOT;

  return {
    ...snapshot,
    ...(workbenchState.fullscreenPtyId ? { fullscreenPtyId: workbenchState.fullscreenPtyId } : {}),
    ...(workbenchState.fullscreenTerminalRecovery ? { fullscreenTerminalRecovery: workbenchState.fullscreenTerminalRecovery } : {}),
  };
}

export function writeAgentsTiledPersistState(
  state: TiledPersistState,
  storage = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const sanitizedState = sanitizePersistState(state);
  const workbenchState = readAgentsTiledWorkbenchPersistState(storage);
  const activeLayoutId = workbenchState.activeLayoutId;
  const activeLayout = workbenchState.layouts[activeLayoutId];
  const timestamp = new Date().toISOString();

  writeAgentsTiledWorkbenchPersistState({
    ...workbenchState,
    layouts: {
      ...workbenchState.layouts,
      [activeLayoutId]: {
        ...(activeLayout ?? {
          id: activeLayoutId,
          name: DEFAULT_TILED_NAMED_LAYOUT_NAME,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastUsedAt: timestamp,
          snapshot: sanitizedState,
        }),
        updatedAt: timestamp,
        snapshot: extractTiledLayoutPersistSnapshot(sanitizedState),
      },
    },
    ...(sanitizedState.fullscreenPtyId ? { fullscreenPtyId: sanitizedState.fullscreenPtyId } : {}),
    ...(sanitizedState.fullscreenTerminalRecovery ? { fullscreenTerminalRecovery: sanitizedState.fullscreenTerminalRecovery } : {}),
  }, storage);
}
