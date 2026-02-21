const DEVELOPER_MODE_STORAGE_KEY = 'exomind:developerMode'; // developer mode（开发者模式）存储键
const DEVELOPER_MODE_CHANGED_EVENT = 'exomind:developer-mode-changed'; // 自定义事件（custom event）

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getDeveloperModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY));
}

export function setDeveloperModeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(DEVELOPER_MODE_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeDeveloperModeChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== DEVELOPER_MODE_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(DEVELOPER_MODE_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(DEVELOPER_MODE_CHANGED_EVENT, handleCustomEvent);
  };
}

