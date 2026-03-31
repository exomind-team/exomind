/**
 * TODO(#749): Once Tauri desktop migration is complete and MigrationDialog no longer
 * falls back to 'legacy', remove the 'legacy' variant and simplify all consumers
 * to assume 'rt-sqlite'. See also: bootstrap.ts, timeblock.service.ts, task.service.ts.
 */
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

function normalizeMode(value: string | null | undefined, domain: DomainBackendKey): DomainBackendMode {
  return value === 'legacy' || value === 'rt-sqlite' ? value : DEFAULTS[domain];
}

function getMode(domain: DomainBackendKey): DomainBackendMode {
  if (typeof window === 'undefined') {
    return DEFAULTS[domain];
  }
  return normalizeMode(window.localStorage.getItem(STORAGE_KEYS[domain]), domain);
}

function setMode(domain: DomainBackendKey, mode: DomainBackendMode): DomainBackendMode {
  const normalized = normalizeMode(mode, domain);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEYS[domain], normalized);
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
