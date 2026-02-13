export const THEME_PREFERENCE_STORAGE_KEY = 'exomind:themePreference';
export const THEME_PREFERENCE_CHANGED_EVENT = 'exomind:theme-preference-changed';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const VALID_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && VALID_PREFERENCES.includes(value as ThemePreference);
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  try {
    const stored = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (!stored) {
      return 'system';
    }

    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
    window.dispatchEvent(
      new CustomEvent(THEME_PREFERENCE_CHANGED_EVENT, {
        detail: { value: preference },
      })
    );
  } catch {
    // ignore localStorage write errors
  }
}

export function resolveThemePreference(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  try {
    return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  if (typeof document === 'undefined') {
    return resolveThemePreference(preference);
  }

  const resolved = resolveThemePreference(preference);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  return resolved;
}

export function subscribeThemePreferenceChanges(
  listener: (preference: ThemePreference) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    if (detail && isThemePreference(detail.value)) {
      listener(detail.value);
    } else {
      listener(getThemePreference());
    }
  };

  window.addEventListener(THEME_PREFERENCE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(THEME_PREFERENCE_CHANGED_EVENT, handler);
}

export function subscribeSystemThemeChanges(listener: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(MEDIA_QUERY);
  } catch {
    return () => {};
  }

  const handler = () => listener(mql.matches ? 'dark' : 'light');

  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }

  mql.addListener(handler);
  return () => mql.removeListener(handler);
}

