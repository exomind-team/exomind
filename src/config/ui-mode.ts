export type UIMode = 'old' | 'new';

const UI_MODE_STORAGE_KEY = 'exomind:uiMode'; // uiMode（界面模式）存储键
const UI_MODE_CHANGED_EVENT = 'exomind:ui-mode-changed'; // 自定义事件（custom event）

function normalizeUIMode(rawValue: string | null | undefined): UIMode {
  return rawValue === 'new' ? 'new' : 'old';
}

export function getUIMode(): UIMode {
  if (typeof window === 'undefined') return 'old';
  return normalizeUIMode(window.localStorage.getItem(UI_MODE_STORAGE_KEY));
}

export function setUIMode(mode: UIMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent<UIMode>(UI_MODE_CHANGED_EVENT, { detail: mode }));
}

export function subscribeUIModeChanges(listener: (mode: UIMode) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== UI_MODE_STORAGE_KEY) return;
    listener(normalizeUIMode(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<UIMode>;
    listener(normalizeUIMode(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(UI_MODE_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(UI_MODE_CHANGED_EVENT, handleCustomEvent);
  };
}

