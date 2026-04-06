import type { TiledPaneSlotBinding } from './tiled-pane-tree';
import {
  createTiledWorkbenchLayoutRecord,
  normalizeTiledPersistState,
  resolveActiveTiledWorkbenchLayout,
  type TiledPersistState,
  type TiledWorkbenchPersistState,
} from './agents-tiled-persistence';

export function bindSessionToTiledSlot(
  slots: TiledPaneSlotBinding[],
  slotId: string,
  sessionId: string,
): TiledPaneSlotBinding[] {
  return slots.map((slot) => {
    if (slot.slotId === slotId) {
      return {
        slotId,
        sessionId,
      };
    }

    if (slot.sessionId === sessionId) {
      return {
        slotId: slot.slotId,
      };
    }

    return slot;
  });
}

export function clearTiledSlotBinding(
  slots: TiledPaneSlotBinding[],
  slotId: string,
): {
  releasedSessionId?: string;
  slots: TiledPaneSlotBinding[];
} {
  let releasedSessionId: string | undefined;

  const nextSlots = slots.map((slot) => {
    if (slot.slotId !== slotId) {
      return slot;
    }

    releasedSessionId = slot.sessionId;
    return {
      slotId,
    };
  });

  return {
    ...(releasedSessionId ? { releasedSessionId } : {}),
    slots: nextSlots,
  };
}

export function reconcileTiledUnassignedSessionIds(
  currentIds: string[],
  visibleSessionIds: string[],
  slots: TiledPaneSlotBinding[],
): string[] {
  const visibleIdSet = new Set(visibleSessionIds);
  const boundSessionIds = new Set(
    slots.flatMap((slot) => (slot.sessionId ? [slot.sessionId] : [])),
  );
  const nextIds = currentIds.filter((id) => visibleIdSet.has(id) && !boundSessionIds.has(id));

  visibleSessionIds.forEach((id) => {
    if (boundSessionIds.has(id) || nextIds.includes(id)) {
      return;
    }
    nextIds.push(id);
  });

  return nextIds;
}

function areSnapshotsEqual(left: TiledPersistState, right: TiledPersistState): boolean {
  return JSON.stringify(normalizeTiledPersistState(left))
    === JSON.stringify(normalizeTiledPersistState(right));
}

export function commitActiveTiledWorkbenchLayoutSnapshot(
  state: TiledWorkbenchPersistState,
  snapshot: TiledPersistState,
  now: string,
): TiledWorkbenchPersistState {
  const activeLayout = resolveActiveTiledWorkbenchLayout(state);
  const normalizedSnapshot = normalizeTiledPersistState(snapshot);

  if (areSnapshotsEqual(activeLayout.snapshot, normalizedSnapshot)) {
    return state;
  }

  return {
    ...state,
    layouts: {
      ...state.layouts,
      [activeLayout.id]: {
        ...activeLayout,
        snapshot: normalizedSnapshot,
        updatedAt: now,
      },
    },
  };
}

export function switchActiveTiledWorkbenchLayout(
  state: TiledWorkbenchPersistState,
  layoutId: string,
  now: string,
): TiledWorkbenchPersistState {
  if (!state.layouts[layoutId] || state.activeLayoutId === layoutId) {
    return state;
  }

  return {
    ...state,
    activeLayoutId: layoutId,
    layouts: {
      ...state.layouts,
      [layoutId]: {
        ...state.layouts[layoutId]!,
        lastUsedAt: now,
      },
    },
  };
}

export function createTiledWorkbenchLayout(
  state: TiledWorkbenchPersistState,
  options: {
    id: string;
    name: string;
    snapshot: TiledPersistState;
    now: string;
    activate?: boolean;
  },
): TiledWorkbenchPersistState {
  const activate = options.activate !== false;
  const nextRecord = createTiledWorkbenchLayoutRecord({
    id: options.id,
    name: options.name,
    snapshot: options.snapshot,
    createdAt: options.now,
    updatedAt: options.now,
    lastUsedAt: options.now,
  });

  return {
    ...state,
    version: 3,
    activeLayoutId: activate ? options.id : state.activeLayoutId,
    layoutOrder: state.layoutOrder.includes(options.id)
      ? state.layoutOrder
      : [...state.layoutOrder, options.id],
    layouts: {
      ...state.layouts,
      [options.id]: nextRecord,
    },
  };
}

export function renameTiledWorkbenchLayout(
  state: TiledWorkbenchPersistState,
  layoutId: string,
  name: string,
  now: string,
): TiledWorkbenchPersistState {
  const layout = state.layouts[layoutId];
  if (!layout) {
    return state;
  }

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName === layout.name) {
    return state;
  }

  return {
    ...state,
    layouts: {
      ...state.layouts,
      [layoutId]: {
        ...layout,
        name: trimmedName,
        updatedAt: now,
      },
    },
  };
}

export function deleteTiledWorkbenchLayout(
  state: TiledWorkbenchPersistState,
  layoutId: string,
  now: string,
): TiledWorkbenchPersistState {
  const layoutIndex = state.layoutOrder.indexOf(layoutId);
  if (layoutIndex === -1 || state.layoutOrder.length <= 1) {
    return state;
  }

  const nextLayoutOrder = state.layoutOrder.filter((id) => id !== layoutId);
  const nextLayouts = { ...state.layouts };
  delete nextLayouts[layoutId];

  if (state.activeLayoutId !== layoutId) {
    return {
      ...state,
      layoutOrder: nextLayoutOrder,
      layouts: nextLayouts,
    };
  }

  const fallbackLayoutId = nextLayoutOrder[Math.max(0, layoutIndex - 1)] ?? nextLayoutOrder[0]!;
  return {
    ...state,
    activeLayoutId: fallbackLayoutId,
    layoutOrder: nextLayoutOrder,
    layouts: {
      ...nextLayouts,
      [fallbackLayoutId]: {
        ...nextLayouts[fallbackLayoutId]!,
        lastUsedAt: now,
      },
    },
  };
}
