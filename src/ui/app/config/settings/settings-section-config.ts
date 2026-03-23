import type { Category } from './settings-types';

export const SETTINGS_CATEGORY_TONE_COLORS: Partial<Record<Category, string>> = {
  danger: '#DC2626',
  developer: 'var(--settings-tone-developer)',
};

export function getSettingsSectionToneColor(categories: Category[]): string | null {
  if (categories.length !== 1) {
    return null;
  }

  return SETTINGS_CATEGORY_TONE_COLORS[categories[0]] ?? null;
}
