export const FEEDBACK_PREFERENCES_STORAGE_KEY = 'exomind:feedbackPreferences';
export const FEEDBACK_PREFERENCES_CHANGED_EVENT = 'exomind:feedback-preferences-changed';
export const FEEDBACK_SKIP_CONFIRM_COOLDOWN_SECONDS = 5;

export type FeedbackPreferences = {
  timingInfoEnabled: boolean;
  statisticsEnabled: boolean;
  quickFeedbackEnabled: boolean;
};

const DEFAULT_FEEDBACK_PREFERENCES: FeedbackPreferences = {
  timingInfoEnabled: false,
  statisticsEnabled: false,
  quickFeedbackEnabled: true,
};

function normalizeFeedbackPreferences(value: unknown): FeedbackPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }

  const record = value as Partial<FeedbackPreferences>;
  return {
    timingInfoEnabled: typeof record.timingInfoEnabled === 'boolean'
      ? record.timingInfoEnabled
      : DEFAULT_FEEDBACK_PREFERENCES.timingInfoEnabled,
    statisticsEnabled: typeof record.statisticsEnabled === 'boolean'
      ? record.statisticsEnabled
      : DEFAULT_FEEDBACK_PREFERENCES.statisticsEnabled,
    quickFeedbackEnabled: typeof record.quickFeedbackEnabled === 'boolean'
      ? record.quickFeedbackEnabled
      : DEFAULT_FEEDBACK_PREFERENCES.quickFeedbackEnabled,
  };
}

export function getFeedbackPreferences(): FeedbackPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(FEEDBACK_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_FEEDBACK_PREFERENCES;
    return normalizeFeedbackPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }
}

export function setFeedbackPreferences(preferences: FeedbackPreferences): void {
  if (typeof window === 'undefined') return;

  try {
    const normalized = normalizeFeedbackPreferences(preferences);
    window.localStorage.setItem(
      FEEDBACK_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    window.dispatchEvent(
      new CustomEvent(FEEDBACK_PREFERENCES_CHANGED_EVENT, {
        detail: { value: normalized },
      }),
    );
  } catch {
    // ignore localStorage write errors
  }
}

export function updateFeedbackPreferences(
  patch: Partial<FeedbackPreferences>,
): FeedbackPreferences {
  const merged = {
    ...getFeedbackPreferences(),
    ...patch,
  };
  const normalized = normalizeFeedbackPreferences(merged);
  setFeedbackPreferences(normalized);
  return normalized;
}

export function subscribeFeedbackPreferencesChanges(
  listener: (preferences: FeedbackPreferences) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== FEEDBACK_PREFERENCES_STORAGE_KEY) return;
    listener(getFeedbackPreferences());
  };

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    listener(normalizeFeedbackPreferences(detail?.value));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(FEEDBACK_PREFERENCES_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(FEEDBACK_PREFERENCES_CHANGED_EVENT, handleCustomEvent);
  };
}
