export const TASK_DAG_PAN_SPEED_STORAGE_KEY = 'exomind:dag-pan-speed';
export const TASK_DAG_PAN_SPEED_CHANGED_EVENT = 'exomind:dag-pan-speed-changed';

export const DEFAULT_TASK_DAG_PAN_SPEED = 40;
export const MIN_TASK_DAG_PAN_SPEED = 10;
export const MAX_TASK_DAG_PAN_SPEED = 200;

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) {
    return null;
  }
  if (typeof localStorageLike.getItem !== 'function' || typeof localStorageLike.setItem !== 'function') {
    return null;
  }

  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function clampTaskDagPanSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TASK_DAG_PAN_SPEED;
  }

  return Math.min(
    MAX_TASK_DAG_PAN_SPEED,
    Math.max(MIN_TASK_DAG_PAN_SPEED, Math.round(value)),
  );
}

export function getTaskDagPanSpeed(): number {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_TASK_DAG_PAN_SPEED;
  }

  try {
    const rawValue = storage.getItem(TASK_DAG_PAN_SPEED_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_TASK_DAG_PAN_SPEED;
    }

    return clampTaskDagPanSpeed(Number.parseInt(rawValue, 10));
  } catch {
    return DEFAULT_TASK_DAG_PAN_SPEED;
  }
}

export function setTaskDagPanSpeed(value: number): number {
  const normalizedValue = clampTaskDagPanSpeed(value);
  const storage = getStorage();
  if (!storage) {
    return normalizedValue;
  }

  try {
    storage.setItem(TASK_DAG_PAN_SPEED_STORAGE_KEY, String(normalizedValue));
    window.dispatchEvent(new CustomEvent(
      TASK_DAG_PAN_SPEED_CHANGED_EVENT,
      { detail: { value: normalizedValue } },
    ));
  } catch {
    // Ignore localStorage write errors.
  }

  return normalizedValue;
}

export function subscribeTaskDagPanSpeedChanges(listener: (value: number) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    if (detail && typeof detail.value === 'number') {
      listener(clampTaskDagPanSpeed(detail.value));
      return;
    }

    listener(getTaskDagPanSpeed());
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== TASK_DAG_PAN_SPEED_STORAGE_KEY) {
      return;
    }

    listener(clampTaskDagPanSpeed(Number.parseInt(event.newValue ?? '', 10)));
  };

  window.addEventListener(TASK_DAG_PAN_SPEED_CHANGED_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(TASK_DAG_PAN_SPEED_CHANGED_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}
