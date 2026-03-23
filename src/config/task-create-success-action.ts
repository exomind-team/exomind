import { createConfigModule } from './config-factory';

export const TASK_CREATE_SUCCESS_ACTION_VALUES = ['refocus', 'open-detail'] as const;
export type TaskCreateSuccessAction = (typeof TASK_CREATE_SUCCESS_ACTION_VALUES)[number];

function normalizeAction(rawValue: string | null | undefined): TaskCreateSuccessAction {
  if (rawValue === 'open-detail') return 'open-detail';
  return 'refocus';
}

const _module = createConfigModule<TaskCreateSuccessAction>({
  storageKey: 'exomind:taskCreateSuccessAction',
  eventName: 'exomind:task-create-success-action-changed',
  defaultValue: 'refocus',
  normalize: normalizeAction,
});

export function getTaskCreateSuccessAction(): TaskCreateSuccessAction {
  return _module.get();
}

export function setTaskCreateSuccessAction(action: TaskCreateSuccessAction): TaskCreateSuccessAction {
  return _module.set(action);
}

export function subscribeTaskCreateSuccessActionChanges(
  listener: (action: TaskCreateSuccessAction) => void,
): () => void {
  return _module.subscribe(listener);
}
