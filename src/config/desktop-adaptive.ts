const DESKTOP_ADAPTIVE_STORAGE_KEY = 'exomind:desktopAdaptiveEnabled'; // desktop adaptive（桌面端适配）存储键
const DESKTOP_ADAPTIVE_CHANGED_EVENT = 'exomind:desktop-adaptive-changed'; // custom event（自定义事件）

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

export function getDesktopAdaptiveEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return normalizeBoolean(window.localStorage.getItem(DESKTOP_ADAPTIVE_STORAGE_KEY));
}

export function setDesktopAdaptiveEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DESKTOP_ADAPTIVE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(DESKTOP_ADAPTIVE_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeDesktopAdaptiveChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== DESKTOP_ADAPTIVE_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(DESKTOP_ADAPTIVE_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(DESKTOP_ADAPTIVE_CHANGED_EVENT, handleCustomEvent);
  };
}
