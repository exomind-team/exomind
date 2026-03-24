const AGENT_PAGE_ENABLED_STORAGE_KEY = 'exomind:agentPageEnabled'; // agent 页面启用状态存储键
const AGENT_PAGE_ENABLED_CHANGED_EVENT = 'exomind:agent-page-enabled-changed'; // 自定义事件

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

export function getAgentPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(AGENT_PAGE_ENABLED_STORAGE_KEY));
}

export function setAgentPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AGENT_PAGE_ENABLED_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(AGENT_PAGE_ENABLED_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeAgentPageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== AGENT_PAGE_ENABLED_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(AGENT_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(AGENT_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);
  };
}
