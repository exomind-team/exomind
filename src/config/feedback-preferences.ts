import { createConfigModule } from './config-factory';

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

function parseStoredFeedbackPreferences(rawValue: string | null | undefined): FeedbackPreferences {
  if (!rawValue) {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }
  try {
    return normalizeFeedbackPreferences(JSON.parse(rawValue));
  } catch {
    return DEFAULT_FEEDBACK_PREFERENCES;
  }
}

const feedbackPreferencesModule = createConfigModule<FeedbackPreferences>({
  storageKey: FEEDBACK_PREFERENCES_STORAGE_KEY,
  eventName: FEEDBACK_PREFERENCES_CHANGED_EVENT,
  defaultValue: DEFAULT_FEEDBACK_PREFERENCES,
  normalize: parseStoredFeedbackPreferences,
  serialize: (value) => JSON.stringify(normalizeFeedbackPreferences(value)),
  persistMode: 'runtime-preferred',
});

export function getFeedbackPreferences(): FeedbackPreferences {
  return feedbackPreferencesModule.get();
}

export function setFeedbackPreferences(preferences: FeedbackPreferences): void {
  feedbackPreferencesModule.set(preferences);
}

export function updateFeedbackPreferences(
  patch: Partial<FeedbackPreferences>,
): FeedbackPreferences {
  const merged = {
    ...getFeedbackPreferences(),
    ...patch,
  };
  return feedbackPreferencesModule.set(merged);
}

export function subscribeFeedbackPreferencesChanges(
  listener: (preferences: FeedbackPreferences) => void,
): () => void {
  return feedbackPreferencesModule.subscribe(listener);
}
