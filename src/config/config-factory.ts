/**
 * Generic factory for localStorage-backed config modules with CustomEvent reactivity.
 *
 * Encapsulates the repeated pattern found across src/config/:
 *  - safe localStorage access (SSR-safe, guards against missing methods)
 *  - read with normalizer (handles missing/invalid raw values)
 *  - CustomEvent dispatch on set (same-tab reactivity)
 *  - StorageEvent listener (cross-tab reactivity)
 *
 * Usage:
 *   const myConfig = createConfigModule({
 *     storageKey: 'exomind:myKey',
 *     eventName:  'exomind:my-key-changed',
 *     defaultValue: 'fallback' as MyType,
 *     normalize: (raw) => raw === 'other' ? 'other' : 'fallback',
 *   });
 *   export const getMyConfig            = myConfig.get;
 *   export const setMyConfig            = myConfig.set;
 *   export const subscribeMyConfigChanges = myConfig.subscribe;
 */

export interface ConfigModuleOptions<T> {
  /** localStorage key */
  storageKey: string;
  /** CustomEvent name dispatched on set */
  eventName: string;
  /** Value returned when storage is unavailable or raw value is absent/invalid */
  defaultValue: T;
  /**
   * Convert the raw localStorage string (or null/undefined) to the typed value.
   * Must always return a valid T — never throw.
   */
  normalize: (raw: string | null | undefined) => T;
  /**
   * Convert T to the string written to localStorage.
   * Defaults to String(value).
   */
  serialize?: (value: T) => string;
}

export interface ConfigModule<T> {
  get: () => T;
  set: (value: T) => T;
  subscribe: (listener: (value: T) => void) => () => void;
}

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const ls = window.localStorage as Partial<Storage> | undefined;
  if (!ls) return null;
  if (typeof ls.getItem !== 'function') return null;
  if (typeof ls.setItem !== 'function') return null;
  return ls as Pick<Storage, 'getItem' | 'setItem'>;
}

export function createConfigModule<T>(options: ConfigModuleOptions<T>): ConfigModule<T> {
  const { storageKey, eventName, defaultValue, normalize } = options;
  const serialize: (value: T) => string = options.serialize ?? String;

  function get(): T {
    const storage = getStorage();
    if (!storage) return defaultValue;
    try {
      return normalize(storage.getItem(storageKey));
    } catch {
      return defaultValue;
    }
  }

  function set(value: T): T {
    // Normalize through the round-trip (serialize → normalize) so callers that
    // pass a value of type T still get the canonical form back, matching the
    // behaviour of hand-written setters that call normalizeXxx(input) first.
    const normalized = normalize(serialize(value));
    const storage = getStorage();
    if (!storage) return normalized;
    try {
      storage.setItem(storageKey, serialize(normalized));
      window.dispatchEvent(new CustomEvent<T>(eventName, { detail: normalized }));
    } catch {
      // ignore localStorage write errors
    }
    return normalized;
  }

  function subscribe(listener: (value: T) => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      listener(normalize(event.newValue));
    };

    const handleCustomEvent = (event: Event) => {
      const customEvent = event as CustomEvent<T>;
      listener(customEvent.detail);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(eventName, handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(eventName, handleCustomEvent);
    };
  }

  return { get, set, subscribe };
}
