export const TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY = 'exomind:dag-manual-layout';
export const TASK_DAG_MANUAL_LAYOUT_CHANGED_EVENT = 'exomind:dag-manual-layout-changed';

export type TaskDagLayoutMode = 'auto' | 'manual';

export type TaskDagNodePosition = {
  x: number;
  y: number;
};

export type TaskDagManualLayoutSnapshot = {
  manualPositions: Record<string, TaskDagNodePosition>;
  manualBaselinePositions: Record<string, TaskDagNodePosition>;
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
    manualBaselinePositions?: unknown;
    updatedAt?: unknown;
  };

  const sanitizePositions = (value: unknown): Record<string, TaskDagNodePosition> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.entries(value).reduce<Record<string, TaskDagNodePosition>>((acc, [nodeId, positionValue]) => {
      if (!positionValue || typeof positionValue !== 'object' || Array.isArray(positionValue)) {
        return acc;
      }

      const position = positionValue as { x?: unknown; y?: unknown };
      if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
        return acc;
      }

      acc[nodeId] = { x: position.x, y: position.y };
      return acc;
    }, {});
  };

  const manualPositions = sanitizePositions(parsed.manualPositions);
  const manualBaselinePositions = sanitizePositions(parsed.manualBaselinePositions);

  if (
    Object.keys(manualPositions).length === 0
    && Object.keys(manualBaselinePositions).length === 0
  ) {
    return null;
  }

  return {
    manualPositions,
    manualBaselinePositions,
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

export function mergeTaskDagManualLayoutPositions(
  snapshot: TaskDagManualLayoutSnapshot | null,
  positions: Record<string, TaskDagNodePosition>,
): TaskDagManualLayoutSnapshot {
  const sanitized = sanitizeTaskDagManualLayoutSnapshot(snapshot);
  return {
    manualPositions: {
      ...(sanitized?.manualPositions ?? {}),
      ...positions,
    },
    manualBaselinePositions: {
      ...(sanitized?.manualBaselinePositions ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function setTaskDagManualLayoutBaselinePositions(
  snapshot: TaskDagManualLayoutSnapshot | null,
  positions: Record<string, TaskDagNodePosition>,
): TaskDagManualLayoutSnapshot {
  const sanitized = sanitizeTaskDagManualLayoutSnapshot(snapshot);
  return {
    manualPositions: {
      ...(sanitized?.manualPositions ?? {}),
    },
    manualBaselinePositions: {
      ...positions,
    },
    updatedAt: new Date().toISOString(),
  };
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
    manualBaselinePositions: {
      ...(sanitized?.manualBaselinePositions ?? {}),
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
  const manualBaselinePositions = Object.entries(sanitized.manualBaselinePositions).reduce<Record<string, TaskDagNodePosition>>((acc, [nodeId, position]) => {
    if (validIdSet.has(nodeId)) {
      acc[nodeId] = position;
    }
    return acc;
  }, {});

  if (
    Object.keys(manualPositions).length === 0
    && Object.keys(manualBaselinePositions).length === 0
  ) {
    return null;
  }

  return {
    manualPositions,
    manualBaselinePositions,
    updatedAt: sanitized.updatedAt,
  };
}
