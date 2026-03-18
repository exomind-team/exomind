import { describe, expect, it } from 'vitest';
import { DESKTOP_TAB_CONFIG } from '@/ui/app/config/settings/desktop-tab-config';
import { SETTINGS_REGISTRY } from '@/ui/app/config/settings/settings-registry';

describe('Settings Registry Consistency', () => {
  it('every registry item has a unique id', () => {
    const ids = SETTINGS_REGISTRY.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every category is reachable from desktop tab config', () => {
    const categories = new Set(SETTINGS_REGISTRY.map((item) => item.category));

    for (const category of categories) {
      expect(
        DESKTOP_TAB_CONFIG.some((tab) => tab.categories.includes(category))
      ).toBe(true);
    }
  });

  it('every registry item uses a supported renderer type', () => {
    const supportedTypes = new Set([
      'boolean',
      'enum',
      'number',
      'string',
      'action',
      'group',
      'custom',
    ]);

    for (const item of SETTINGS_REGISTRY) {
      expect(supportedTypes.has(item.type)).toBe(true);
    }
  });

  it('voice-shortcut-hotkey allows await when set returns a promise', async () => {
    const hotkeyItem = SETTINGS_REGISTRY.find((item) => item.id === 'voice-shortcut-hotkey');

    expect(hotkeyItem).toBeDefined();
    expect(hotkeyItem?.type).toBe('enum');

    if (!hotkeyItem || hotkeyItem.type !== 'enum' || hotkeyItem.multiSelect === true) {
      throw new Error('voice-shortcut-hotkey must be a single enum registry item');
    }

    const result = hotkeyItem.set(hotkeyItem.options[0].value);
    await expect(Promise.resolve(result)).resolves.toBeUndefined();
  });

  it('main-window-shortcut allows await when set returns a promise', async () => {
    const shortcutItem = SETTINGS_REGISTRY.find((item) => item.id === 'main-window-shortcut');

    expect(shortcutItem).toBeDefined();
    expect(shortcutItem?.type).toBe('enum');

    if (!shortcutItem || shortcutItem.type !== 'enum' || shortcutItem.multiSelect !== true) {
      throw new Error('main-window-shortcut must be a multi enum registry item');
    }

    const result = shortcutItem.set(['Alt', 'E']);
    await expect(Promise.resolve(result)).resolves.toEqual(['Alt', 'E']);
  });
});
