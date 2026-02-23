const USE_MOCK_DATA_STORAGE_KEY = 'exomind:useMockData'; // mock data flag（测试数据开关）存储键
const USE_MOCK_DATA_CHANGED_EVENT = 'exomind:use-mock-data-changed'; // custom event（自定义事件）

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getUseMockDataEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(USE_MOCK_DATA_STORAGE_KEY));
}

export function setUseMockDataEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USE_MOCK_DATA_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(USE_MOCK_DATA_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeUseMockDataChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== USE_MOCK_DATA_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(USE_MOCK_DATA_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(USE_MOCK_DATA_CHANGED_EVENT, handleCustomEvent);
  };
}

