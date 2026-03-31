import {
  readRuntimeBackedValue,
  writeRuntimeBackedValue,
} from './runtime-preference-storage';

export const TASK_TIMER_AUTO_FILL_STORAGE_KEY = 'exomind:task-timer:auto-fill';
export const TASK_TIMER_AUTO_FILL_CHANGED_EVENT = 'exomind:task-timer-auto-fill-changed';

export function getTaskTimerAutoFillEnabled(): boolean {
  return readRuntimeBackedValue(TASK_TIMER_AUTO_FILL_STORAGE_KEY) === '1';
}

export function setTaskTimerAutoFillEnabled(enabled: boolean): boolean {
  writeRuntimeBackedValue(
    TASK_TIMER_AUTO_FILL_STORAGE_KEY,
    enabled ? '1' : '0',
    TASK_TIMER_AUTO_FILL_CHANGED_EVENT,
  );
  return enabled;
}
