import { createConfigModule } from './config-factory';

const API_AGENT_TAB_ENABLED_STORAGE_KEY = 'exomind:apiAgentTabEnabled'; // API Agent tab 开关存储键
const API_AGENT_TAB_ENABLED_CHANGED_EVENT = 'exomind:api-agent-tab-enabled-changed'; // API Agent tab 开关事件

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const apiAgentTabEnabledModule = createConfigModule<boolean>({
  storageKey: API_AGENT_TAB_ENABLED_STORAGE_KEY,
  eventName: API_AGENT_TAB_ENABLED_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getApiAgentTabEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return apiAgentTabEnabledModule.get();
}

export function setApiAgentTabEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  apiAgentTabEnabledModule.set(enabled);
}

export function subscribeApiAgentTabEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return apiAgentTabEnabledModule.subscribe(listener);
}
