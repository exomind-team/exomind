import { describe, expect, it } from 'vitest';
import { DESKTOP_TAB_CONFIG } from '@/ui/app/config/settings/desktop-tab-config';
import { SETTINGS_REGISTRY } from '@/ui/app/config/settings/settings-registry';
import type { SettingsItem } from '@/ui/app/config/settings/settings-types';

function findRegistryItemById(items: SettingsItem[], id: string): SettingsItem | undefined {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }
    if (item.type === 'group') {
      const child = findRegistryItemById(item.children, id);
      if (child) {
        return child;
      }
    }
  }
  return undefined;
}

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

  it('keeps tiled workbench shortcut settings under terminal-agent', () => {
    [
      'tiled-workbench-navigation-shortcut-scheme',
      'tiled-workbench-command-shortcut-scheme',
      'tiled-workbench-passthrough-shortcut',
    ].forEach((id) => {
      const item = SETTINGS_REGISTRY.find((entry) => entry.id === id);

      expect(item).toBeDefined();
      expect(item?.category).toBe('terminal-agent');
    });
  });

  it('hides domain backend mode toggles in Web runtime because Web data flow is RT-only', () => {
    const webCtx = {
      isDesktop: true,
      isTauriWindow: false,
      developerMode: true,
    };

    for (const id of ['eventlog-backend-mode', 'task-backend-mode', 'timeblock-backend-mode']) {
      const item = SETTINGS_REGISTRY.find((entry) => entry.id === id);
      expect(item).toBeDefined();
      expect(item?.visible?.(webCtx)).toBe(false);
    }
  });

  it('voice-shortcut-hotkey allows await when set returns a promise', async () => {
    const hotkeyItem = findRegistryItemById(SETTINGS_REGISTRY, 'voice-shortcut-hotkey');

    expect(hotkeyItem).toBeDefined();
    expect(hotkeyItem?.type).toBe('enum');

    if (!hotkeyItem || hotkeyItem.type !== 'enum' || hotkeyItem.multiSelect === true) {
      throw new Error('voice-shortcut-hotkey must be a single enum registry item');
    }

    const result = hotkeyItem.set(hotkeyItem.options[0].value);
    await expect(Promise.resolve(result)).resolves.toBeUndefined();
  });

  it('main-window-shortcut allows await when set returns a promise', async () => {
    const shortcutItem = findRegistryItemById(SETTINGS_REGISTRY, 'main-window-shortcut');

    expect(shortcutItem).toBeDefined();
    expect(shortcutItem?.type).toBe('enum');

    if (!shortcutItem || shortcutItem.type !== 'enum' || shortcutItem.multiSelect !== true) {
      throw new Error('main-window-shortcut must be a multi enum registry item');
    }

    const result = shortcutItem.set(['Ctrl', 'E']);
    await expect(Promise.resolve(result)).resolves.toEqual(['Ctrl', 'E']);
  });
});
