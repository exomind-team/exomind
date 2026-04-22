import { createConfigModule } from './config-factory';

export const EVENTLOG_MARKDOWN_MIRROR_ENABLED_STORAGE_KEY =
  'exomind:eventlogMarkdownMirrorEnabled';
export const EVENTLOG_MARKDOWN_MIRROR_ENABLED_CHANGED_EVENT =
  'exomind:eventlog-markdown-mirror-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const _module = createConfigModule<boolean>({
  storageKey: EVENTLOG_MARKDOWN_MIRROR_ENABLED_STORAGE_KEY,
  eventName: EVENTLOG_MARKDOWN_MIRROR_ENABLED_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  persistMode: 'runtime-preferred',
});

export function getEventlogMarkdownMirrorEnabled(): boolean {
  return _module.get();
}

export function setEventlogMarkdownMirrorEnabled(enabled: boolean): void {
  _module.set(enabled);
}

export function subscribeEventlogMarkdownMirrorEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return _module.subscribe(listener);
}
