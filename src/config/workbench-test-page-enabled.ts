const WORKBENCH_TEST_PAGE_ENABLED_STORAGE_KEY = 'exomind:workbenchTestPageEnabled';
const WORKBENCH_TEST_PAGE_ENABLED_CHANGED_EVENT = 'exomind:workbench-test-page-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getWorkbenchTestPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(WORKBENCH_TEST_PAGE_ENABLED_STORAGE_KEY));
}

export function setWorkbenchTestPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WORKBENCH_TEST_PAGE_ENABLED_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(WORKBENCH_TEST_PAGE_ENABLED_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeWorkbenchTestPageEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== WORKBENCH_TEST_PAGE_ENABLED_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(WORKBENCH_TEST_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(WORKBENCH_TEST_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);
  };
}
