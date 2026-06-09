import { createConfigModule } from './config-factory';

export const TASK_DAG_PAN_SPEED_STORAGE_KEY = 'exomind:dag-pan-speed';
export const TASK_DAG_PAN_SPEED_CHANGED_EVENT = 'exomind:dag-pan-speed-changed';
export const TASK_DAG_ZOOM_SPEED_STORAGE_KEY = 'exomind:dag-zoom-speed';
export const TASK_DAG_ZOOM_SPEED_CHANGED_EVENT = 'exomind:dag-zoom-speed-changed';

export const DEFAULT_TASK_DAG_PAN_SPEED = 480;
export const MIN_TASK_DAG_PAN_SPEED = 120;
export const MAX_TASK_DAG_PAN_SPEED = 2400;
export const DEFAULT_TASK_DAG_ZOOM_SPEED = 30;
export const MIN_TASK_DAG_ZOOM_SPEED = 10;
export const MAX_TASK_DAG_ZOOM_SPEED = 80;

function clampTaskDagPanSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TASK_DAG_PAN_SPEED;
  }

  return Math.min(
    MAX_TASK_DAG_PAN_SPEED,
    Math.max(MIN_TASK_DAG_PAN_SPEED, Math.round(value)),
  );
}

function clampTaskDagZoomSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TASK_DAG_ZOOM_SPEED;
  }

  return Math.min(
    MAX_TASK_DAG_ZOOM_SPEED,
    Math.max(MIN_TASK_DAG_ZOOM_SPEED, Math.round(value)),
  );
}

const taskDagPanSpeedModule = createConfigModule<number>({
  storageKey: TASK_DAG_PAN_SPEED_STORAGE_KEY,
  eventName: TASK_DAG_PAN_SPEED_CHANGED_EVENT,
  defaultValue: DEFAULT_TASK_DAG_PAN_SPEED,
  normalize: (rawValue) => clampTaskDagPanSpeed(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampTaskDagPanSpeed(value)),
  persistMode: 'runtime-preferred',
});

const taskDagZoomSpeedModule = createConfigModule<number>({
  storageKey: TASK_DAG_ZOOM_SPEED_STORAGE_KEY,
  eventName: TASK_DAG_ZOOM_SPEED_CHANGED_EVENT,
  defaultValue: DEFAULT_TASK_DAG_ZOOM_SPEED,
  normalize: (rawValue) => clampTaskDagZoomSpeed(Number.parseInt(rawValue ?? '', 10)),
  serialize: (value) => String(clampTaskDagZoomSpeed(value)),
  persistMode: 'runtime-preferred',
});

export function getTaskDagPanSpeed(): number {
  return taskDagPanSpeedModule.get();
}

export function setTaskDagPanSpeed(value: number): number {
  return taskDagPanSpeedModule.set(value);
}

export function getTaskDagZoomSpeed(): number {
  return taskDagZoomSpeedModule.get();
}

export function setTaskDagZoomSpeed(value: number): number {
  return taskDagZoomSpeedModule.set(value);
}

export function subscribeTaskDagPanSpeedChanges(listener: (value: number) => void): () => void {
  return taskDagPanSpeedModule.subscribe(listener);
}

export function subscribeTaskDagZoomSpeedChanges(listener: (value: number) => void): () => void {
  return taskDagZoomSpeedModule.subscribe(listener);
}
