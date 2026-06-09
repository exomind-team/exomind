import { describe, expect, it, vi } from 'vitest';

vi.mock('@/adapters/crypto-adapter', () => ({
  sha256: vi.fn(async () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
}));

vi.mock('@/lib/eventlog/source-metadata', () => ({
  getEventSourceMetadata: () => ({
    deviceId: 'device-1',
    deviceName: 'Pixel 9',
    platform: 'android',
    app: 'ExoMind',
  }),
}));

import { buildVoiceShortcutStorageEvent } from '@/services/voice-shortcut-eventlog';

describe('buildVoiceShortcutStorageEvent (#612)', () => {
  it('adds voice metadata and normalized shortcut context', async () => {
    const event = await buildVoiceShortcutStorageEvent({
      text: '  语音记录测试  ',
      startedAtMs: 1_700_000_000_321,
      targetScope: 'agent-chat',
      window: {
        title: ' Cursor ',
        processName: ' Cursor.exe ',
      },
      agentContext: {
        agentId: ' codex ',
        agentName: ' Codex ',
        sessionId: ' session-1 ',
      },
    });

    expect(event.id).toBe('voice-shortcut:0123456789abcdef0123456789abcdef');
    expect(event.content).toBe('语音记录测试');
    expect(event.type).toBe('voice');
    expect(event.metadata).toEqual(expect.objectContaining({
      source: {
        deviceId: 'device-1',
        deviceName: 'Pixel 9',
        platform: 'android',
        app: 'ExoMind',
      },
      inputSource: 'voice',
      inputMethod: 'recognition',
      voiceShortcut: expect.objectContaining({
        dedupVersion: 'v1',
        captureSource: 'global-shortcut',
        targetScope: 'agent-chat',
        text: '语音记录测试',
        window: {
          title: 'Cursor',
          processName: 'Cursor.exe',
        },
        agentContext: {
          agentId: 'codex',
          agentName: 'Codex',
          sessionId: 'session-1',
        },
      }),
    }));
  });
});
