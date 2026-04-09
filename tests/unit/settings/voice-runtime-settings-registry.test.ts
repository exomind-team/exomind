import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(async () => false),
}));

import '../components/settings/setup-settings-mocks.tsx';
import { getVisibleSettings } from '@/ui/app/config/settings/settings-registry';
import type { SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

function getBaseCtx(): SettingsContext {
  return {
    isDesktop: false,
    isTauriWindow: false,
    developerMode: false,
    desktopAdaptiveEnabled: false,
    voiceShortcutAsrProvider: 'moss',
    voiceRuntimeProvider: 'doubao-o2-realtime',
    voiceRuntimeMode: 'push-to-talk',
  };
}

function flattenVisibleIds(items: SettingsItem[], ctx: SettingsContext): string[] {
  return items.flatMap((item) => {
    if (item.visible && !item.visible(ctx)) {
      return [];
    }
    if (item.type === 'group') {
      return [item.id, ...flattenVisibleIds(item.children, ctx)];
    }
    return [item.id];
  });
}

describe('voice runtime settings registry（语音运行时设置注册）', () => {
  it('uses voice assistant group and keeps diagnostics behind developer mode（使用常驻语音助手分组并将诊断收口到开发者模式）', () => {
    const baseCtx = getBaseCtx();
    const omniCompatibleCtx = {
      ...getBaseCtx(),
      voiceRuntimeProvider: 'qwen-omni-compatible',
    } satisfies SettingsContext;
    const omniRealtimeCtx = {
      ...getBaseCtx(),
      voiceRuntimeProvider: 'qwen-omni-realtime',
    } satisfies SettingsContext;
    const baseItems = getVisibleSettings(baseCtx);
    const omniCompatibleItems = getVisibleSettings(omniCompatibleCtx);
    const omniRealtimeItems = getVisibleSettings(omniRealtimeCtx);

    const baseTopLevelIds = baseItems.map((item) => item.id);
    const baseVisibleIds = flattenVisibleIds(baseItems, baseCtx);
    const omniCompatibleVisibleIds = flattenVisibleIds(omniCompatibleItems, omniCompatibleCtx);
    const omniRealtimeVisibleIds = flattenVisibleIds(omniRealtimeItems, omniRealtimeCtx);

    expect(baseTopLevelIds).toContain('voice-assistant-settings');
    expect(baseTopLevelIds).toContain('voice-input-settings');
    expect(baseTopLevelIds).not.toContain('voice-dialogue-settings');
    expect(baseTopLevelIds).not.toContain('voice-diagnostics-settings');

    [
      'voice-runtime-cloud-session-policy',
      'voice-runtime-auto-speak-enabled',
      'voice-runtime-doubao-app-id',
    ].forEach((id) => {
      expect(baseVisibleIds).toContain(id);
    });
    expect(baseVisibleIds).not.toContain('voice-runtime-omni-compatible-model');
    expect(baseVisibleIds).not.toContain('voice-runtime-omni-api-key');

    [
      'voice-runtime-omni-compatible-model',
      'voice-runtime-omni-compatible-base-url',
      'voice-runtime-omni-compatible-audio-format',
    ].forEach((id) => {
      expect(omniCompatibleVisibleIds).toContain(id);
    });

    [
      'voice-runtime-omni-api-key',
      'voice-runtime-omni-model',
      'voice-runtime-omni-voice',
      'voice-runtime-omni-websocket-url',
    ].forEach((id) => {
      expect(omniRealtimeVisibleIds).toContain(id);
    });

    expect(baseVisibleIds).not.toContain('voice-runtime-lab-nav-enabled');
    expect(baseVisibleIds).not.toContain('open-voice-runtime-lab');
    expect(omniCompatibleVisibleIds).not.toContain('voice-runtime-lab-nav-enabled');
    expect(omniRealtimeVisibleIds).not.toContain('open-voice-runtime-lab');
  });
});
