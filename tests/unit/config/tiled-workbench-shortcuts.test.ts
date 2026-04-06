import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('tiled workbench shortcut config（平铺工作台快捷键配置）', () => {
  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('uses Alt+Shift presets by default（默认使用 Alt+Shift 预设）', async () => {
    const module = await import('@/config/tiled-workbench-shortcuts');

    expect(module.getTiledWorkbenchNavigationShortcutScheme()).toBe('alt-shift-arrows');
    expect(module.getTiledWorkbenchCommandShortcutScheme()).toBe('alt-shift-letters');
    expect(module.getTiledWorkbenchPassthroughShortcut()).toBe('Alt+Shift+P');
    expect(module.getResolvedTiledWorkbenchShortcuts()).toEqual({
      focusLeft: 'Alt+Shift+ArrowLeft',
      focusRight: 'Alt+Shift+ArrowRight',
      focusUp: 'Alt+Shift+ArrowUp',
      focusDown: 'Alt+Shift+ArrowDown',
      splitHorizontal: 'Alt+Shift+H',
      splitVertical: 'Alt+Shift+V',
      clearSlot: 'Alt+Shift+Backspace',
      closeSlot: 'Alt+Shift+X',
      openSlotEntry: 'Alt+Shift+Enter',
      passthroughTrigger: 'Alt+Shift+P',
    });
  });

  it('supports alternate schemes and disabled groups（支持替代方案与禁用组）', async () => {
    const module = await import('@/config/tiled-workbench-shortcuts');
    const navigationListener = vi.fn();
    const unsubscribe = module.subscribeTiledWorkbenchNavigationShortcutSchemeChanges(navigationListener);

    expect(module.setTiledWorkbenchNavigationShortcutScheme('alt-arrows')).toBe('alt-arrows');
    expect(module.setTiledWorkbenchCommandShortcutScheme('disabled')).toBe('disabled');
    expect(module.setTiledWorkbenchPassthroughShortcut('Alt+P')).toBe('Alt+P');

    expect(window.localStorage.getItem(
      module.TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_STORAGE_KEY,
    )).toBe('alt-arrows');
    expect(module.getResolvedTiledWorkbenchShortcuts()).toEqual({
      focusLeft: 'Alt+ArrowLeft',
      focusRight: 'Alt+ArrowRight',
      focusUp: 'Alt+ArrowUp',
      focusDown: 'Alt+ArrowDown',
      splitHorizontal: null,
      splitVertical: null,
      clearSlot: null,
      closeSlot: null,
      openSlotEntry: null,
      passthroughTrigger: 'Alt+P',
    });
    expect(navigationListener).toHaveBeenCalledWith('alt-arrows');

    unsubscribe();
  });

  it('normalizes shortcuts and matches keyboard events（快捷键序列化与匹配会规范化）', async () => {
    const module = await import('@/config/tiled-workbench-shortcuts');

    expect(module.serializeKeyboardShortcut({
      key: 'arrowleft',
      altKey: true,
      shiftKey: true,
    })).toBe('Alt+Shift+ArrowLeft');
    expect(module.serializeKeyboardShortcut({
      key: 'v',
      altKey: true,
    })).toBe('Alt+V');
    expect(module.serializeKeyboardShortcut({
      key: 'Meta',
      metaKey: true,
    })).toBeNull();

    expect(module.matchesKeyboardShortcutEvent({
      key: 'ArrowLeft',
      altKey: true,
      shiftKey: true,
    }, 'Alt+Shift+ArrowLeft')).toBe(true);
    expect(module.matchesKeyboardShortcutEvent({
      key: 'V',
      altKey: true,
      shiftKey: true,
    }, 'Alt+Shift+V')).toBe(true);
    expect(module.matchesKeyboardShortcutEvent({
      key: 'V',
      altKey: true,
    }, 'Alt+Shift+V')).toBe(false);
  });
});
