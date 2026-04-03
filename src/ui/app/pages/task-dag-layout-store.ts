export const TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY = 'exomind:dag-manual-layout';
export const TASK_DAG_MANUAL_LAYOUT_CHANGED_EVENT = 'exomind:dag-manual-layout-changed';

export type TaskDagLayoutMode = 'auto' | 'manual';

export type TaskDagNodePosition = {
  x: number;
  y: number;
};

export type TaskDagManualLayoutSnapshot = {
  manualPositions: Record<string, TaskDagNodePosition>;
  updatedAt: string;
};

const FALLBACK_UPDATED_AT = new Date(0).toISOString();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function dispatchLayoutChange(snapshot: TaskDagManualLayoutSnapshot | null): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(new CustomEvent(TASK_DAG_MANUAL_LAYOUT_CHANGED_EVENT, {
    detail: snapshot,
  }));
}

export function sanitizeTaskDagManualLayoutSnapshot(
  snapshot: unknown,
): TaskDagManualLayoutSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  const parsed = snapshot as {
    manualPositions?: unknown;
    updatedAt?: unknown;
  };
  if (!parsed.manualPositions || typeof parsed.manualPositions !== 'object' || Array.isArray(parsed.manualPositions)) {
    return null;
  }

  const manualPositions = Object.entries(parsed.manualPositions).reduce<Record<string, TaskDagNodePosition>>((acc, [nodeId, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return acc;
    }

    const position = value as { x?: unknown; y?: unknown };
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
      return acc;
    }

    acc[nodeId] = { x: position.x, y: position.y };
    return acc;
  }, {});

  if (Object.keys(manualPositions).length === 0) {
    return null;
  }

  return {
    manualPositions,
    updatedAt:
      typeof parsed.updatedAt === 'string' && !Number.isNaN(Date.parse(parsed.updatedAt))
        ? parsed.updatedAt
        : FALLBACK_UPDATED_AT,
  };
}

export function getTaskDagManualLayoutSnapshot(): TaskDagManualLayoutSnapshot | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    return sanitizeTaskDagManualLayoutSnapshot(
      JSON.parse(storage.getItem(TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return null;
  }
}

export function setTaskDagManualLayoutSnapshot(
  snapshot: TaskDagManualLayoutSnapshot | null,
): TaskDagManualLayoutSnapshot | null {
  const storage = getStorage();
  const sanitized = sanitizeTaskDagManualLayoutSnapshot(snapshot);

  if (storage) {
    if (sanitized) {
      storage.setItem(TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY, JSON.stringify(sanitized));
    } else {
      storage.removeItem(TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY);
    }
  }

  dispatchLayoutChange(sanitized);
  return sanitized;
}

export function updateTaskDagManualLayoutPosition(
  snapshot: TaskDagManualLayoutSnapshot | null,
  nodeId: string,
  position: TaskDagNodePosition,
): TaskDagManualLayoutSnapshot {
  const sanitized = sanitizeTaskDagManualLayoutSnapshot(snapshot);
  return {
    manualPositions: {
      ...(sanitized?.manualPositions ?? {}),
      [nodeId]: {
        x: position.x,
        y: position.y,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function pruneTaskDagManualLayoutSnapshot(
  snapshot: TaskDagManualLayoutSnapshot | null,
  validNodeIds: string[],
): TaskDagManualLayoutSnapshot | null {
  const sanitized = sanitizeTaskDagManualLayoutSnapshot(snapshot);
  if (!sanitized) {
    return null;
  }

  const validIdSet = new Set(validNodeIds);
  const manualPositions = Object.entries(sanitized.manualPositions).reduce<Record<string, TaskDagNodePosition>>((acc, [nodeId, position]) => {
    if (validIdSet.has(nodeId)) {
      acc[nodeId] = position;
    }
    return acc;
  }, {});

  if (Object.keys(manualPositions).length === 0) {
    return null;
  }

  return {
    manualPositions,
    updatedAt: sanitized.updatedAt,
  };
}
