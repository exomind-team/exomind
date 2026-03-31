import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';

export type DomainBackendMode = 'legacy' | 'rt-sqlite';
export type DomainBackendKey = 'eventlog' | 'task' | 'timeblock';

const STORAGE_KEYS: Record<DomainBackendKey, string> = {
  eventlog: 'exomind:eventlogBackendMode',
  task: 'exomind:taskBackendMode',
  timeblock: 'exomind:timeblockBackendMode',
};

const DEFAULTS: Record<DomainBackendKey, DomainBackendMode> = {
  eventlog: 'rt-sqlite',
  task: 'rt-sqlite',
  timeblock: 'rt-sqlite',
};
const DOMAIN_BACKEND_MODE_CHANGED_SOURCE = 'exomind:domain-backend-mode-changed';

function normalizeMode(value: string | null | undefined, domain: DomainBackendKey): DomainBackendMode {
  return value === 'legacy' || value === 'rt-sqlite' ? value : DEFAULTS[domain];
}

function getMode(domain: DomainBackendKey): DomainBackendMode {
  return normalizeMode(getRuntimeConfigValueSync(STORAGE_KEYS[domain]), domain);
}

function setMode(domain: DomainBackendKey, mode: DomainBackendMode): DomainBackendMode {
  const normalized = normalizeMode(mode, domain);
  if (typeof window !== 'undefined') {
    setRuntimeConfigValue(STORAGE_KEYS[domain], normalized, {
      source: DOMAIN_BACKEND_MODE_CHANGED_SOURCE,
      sourceOrigin: window.location?.origin,
    });
  }
  return normalized;
}

export function getEventlogBackendMode(): DomainBackendMode {
  return getMode('eventlog');
}

export function setEventlogBackendMode(mode: DomainBackendMode): DomainBackendMode {
  return setMode('eventlog', mode);
}

export function getTaskBackendMode(): DomainBackendMode {
  return getMode('task');
}

export function setTaskBackendMode(mode: DomainBackendMode): DomainBackendMode {
  return setMode('task', mode);
}

export function getTimeblockBackendMode(): DomainBackendMode {
  return getMode('timeblock');
}

export function setTimeblockBackendMode(mode: DomainBackendMode): DomainBackendMode {
  return setMode('timeblock', mode);
}

export function setAllBackendModes(mode: DomainBackendMode): void {
  setMode('eventlog', mode);
  setMode('task', mode);
  setMode('timeblock', mode);
}
