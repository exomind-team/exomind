import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';
/**
 * TODO(#749): Once runtime-config import/export and diagnostics no longer need to
 * preserve historical values, remove the 'legacy' variant entirely. Runtime task
 * and timeblock reads are already pinned to 'rt-sqlite'; legacy setters remain
 * only so old config payloads can still be round-tripped or inspected.
 *
 * Note: getTaskBackendMode() / getTimeblockBackendMode() are pinned to
 * 'rt-sqlite'. These domains no longer run in legacy mode at runtime.
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
  // Task domain is pinned to rt-sqlite; legacy mode is no longer supported
  // at runtime. setTaskBackendMode() is kept only for historical config
  // compatibility and diagnostics. See TODO(#749).
  return 'rt-sqlite';
}

export function setTaskBackendMode(mode: DomainBackendMode): DomainBackendMode {
  return setMode('task', mode);
}

export function getTimeblockBackendMode(): DomainBackendMode {
  // Timeblock domain is pinned to rt-sqlite; legacy mode is no longer supported
  // at runtime. setTimeblockBackendMode() remains for MigrationDialog migration
  // semantics only. See TODO(#749).
  return 'rt-sqlite';
}

export function setTimeblockBackendMode(mode: DomainBackendMode): DomainBackendMode {
  return setMode('timeblock', mode);
}

export function setAllBackendModes(mode: DomainBackendMode): void {
  setMode('eventlog', mode);
  setMode('task', mode);
  setMode('timeblock', mode);
}
