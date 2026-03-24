import { useEffect } from 'react';
import type { ThemePreference } from '@/config/theme';
import {
  applyThemePreference,
  getThemePreference,
  subscribeSystemThemeChanges,
  subscribeThemePreferenceChanges,
} from '@/config/theme';

function syncSystemTheme(preference: ThemePreference): () => void {
  if (preference !== 'system') {
    return () => {};
  }

  return subscribeSystemThemeChanges(() => {
    applyThemePreference('system');
  });
}

export function ThemeController() {
  useEffect(() => {
    let preference = getThemePreference();
    applyThemePreference(preference);

    let unsubscribeSystem = syncSystemTheme(preference);
    const unsubscribePreference = subscribeThemePreferenceChanges((nextPreference) => {
      preference = nextPreference;
      applyThemePreference(preference);
      unsubscribeSystem();
      unsubscribeSystem = syncSystemTheme(preference);
    });

    return () => {
      unsubscribePreference();
      unsubscribeSystem();
    };
  }, []);

  return null;
}

