import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuickExitShortcutSetting } from '@/ui/app/components/settings/quick-exit-shortcut-setting';
import {
  createBetaSettingsRegistry,
  type BetaSettingsBindings,
} from '@/beta/settings-registry';
import { __resetRuntimeConfigCacheForTests } from '@/config/runtime-config-cache';

function bindings(overrides: Partial<BetaSettingsBindings> = {}): BetaSettingsBindings {
  return {
    nativeDesktop: true,
    android: false,
    desktopLoading: false,
    desktopError: '',
    profileName: 'Profile P',
    profileId: '11111111-1111-4111-8111-111111111111',
    appVersion: 'test',
    buildHash: 'test',
    fullscreen: {
      get: () => false,
      set: async () => false,
    },
    refreshDesktop: async () => {},
    ...overrides,
  };
}

describe('Beta quick-exit integration', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses the shared quick-exit setting in the native desktop Beta registry', () => {
    const item = createBetaSettingsRegistry(bindings())
      .find(candidate => candidate.id === 'quick-exit-shortcut');

    expect(item).toMatchObject({
      id: 'quick-exit-shortcut',
      category: 'input',
      type: 'custom',
      component: QuickExitShortcutSetting,
    });
  });

  it.each([
    ['Android', { nativeDesktop: false, android: true }],
    ['iOS', { nativeDesktop: false, android: false }],
  ])('omits the quick-exit setting on %s', (_platform, overrides) => {
    expect(
      createBetaSettingsRegistry(bindings(overrides))
        .some(candidate => candidate.id === 'quick-exit-shortcut'),
    ).toBe(false);
  });

  it('initializes the persisted shortcut from the Beta renderer entry', () => {
    const entry = readFileSync('src/beta-main.tsx', 'utf8');

    expect(entry.match(/initQuickExitShortcutRuntime/g)).toHaveLength(2);
  });

  it('wires Beta Native to the shared commands and Beta-owned shutdown path', () => {
    const native = readFileSync('src-tauri/src/beta_native.rs', 'utf8');
    const commandModule = readFileSync('src-tauri/src/commands/mod.rs', 'utf8');

    expect(native).toMatch(/QuickExitShortcutState::with_exit_handler\(request_exit\)/);
    expect(native).toMatch(/\.manage\(quick_exit_shortcut_state\)/);
    expect(native).toContain('shortcut_commands::register_quick_exit_shortcut');
    expect(native).toContain('shortcut_commands::quick_exit_shortcut_set');
    expect(native).toContain('shortcut_commands::quick_exit_shortcut_get');
    expect(native).not.toContain('app_lifecycle::request_exit');
    expect(commandModule).toMatch(/\npub mod shortcut_commands;/);
  });
});
