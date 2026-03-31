import { createConfigModule } from './config-factory';

const AGENT_PAGE_ENABLED_STORAGE_KEY = 'exomind:agentPageEnabled'; // agent 页面启用状态存储键
const AGENT_PAGE_ENABLED_CHANGED_EVENT = 'exomind:agent-page-enabled-changed'; // 自定义事件

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

const agentPageEnabledModule = createConfigModule<boolean>({
  storageKey: AGENT_PAGE_ENABLED_STORAGE_KEY,
  eventName: AGENT_PAGE_ENABLED_CHANGED_EVENT,
  defaultValue: true,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getAgentPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return agentPageEnabledModule.get();
}

export function setAgentPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  agentPageEnabledModule.set(enabled);
}

export function subscribeAgentPageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  return agentPageEnabledModule.subscribe(listener);
}
