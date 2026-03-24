import { describe, expect, it } from 'vitest';
import { buildVoiceShortcutStorageEvent } from '@/services/voice-shortcut-eventlog';

describe('buildVoiceShortcutStorageEvent（全局语音快捷键事件构造）', () => {
  it('uses the same id inside the same activation bucket（同一激活时间桶内生成相同幂等 ID）', async () => {
    const first = await buildVoiceShortcutStorageEvent({
      text: '重复语音',
      startedAtMs: 1_700_000_000_123,
      targetScope: 'external-window',
      window: {
        title: 'Cursor - ExoMind',
        processName: 'Cursor.exe',
      },
    });
    const second = await buildVoiceShortcutStorageEvent({
      text: '重复语音',
      startedAtMs: 1_700_000_000_499,
      targetScope: 'external-window',
      window: {
        title: 'Cursor - ExoMind',
        processName: 'Cursor.exe',
      },
    });

    expect(first.id).toBe(second.id);
    expect(first.metadata).toEqual(expect.objectContaining({
      voiceShortcut: expect.objectContaining({
        dedupVersion: 'v1',
        activationBucketMs: 1_700_000_000_000,
        captureSource: 'global-shortcut',
      }),
    }));
  });

  it('changes id when activation bucket changes（激活时间桶变化时生成不同 ID）', async () => {
    const first = await buildVoiceShortcutStorageEvent({
      text: '重复语音',
      startedAtMs: 1_700_000_000_123,
      targetScope: 'external-window',
    });
    const second = await buildVoiceShortcutStorageEvent({
      text: '重复语音',
      startedAtMs: 1_700_000_000_501,
      targetScope: 'external-window',
    });

    expect(first.id).not.toBe(second.id);
  });

  it('changes id when target changes even with same text and bucket（同文同桶但目标不同也不能混并）', async () => {
    const externalWindowEvent = await buildVoiceShortcutStorageEvent({
      text: '打开今天日志',
      startedAtMs: 1_700_000_000_123,
      targetScope: 'external-window',
      window: {
        title: 'Cursor - ExoMind',
        processName: 'Cursor.exe',
      },
    });
    const agentChatEvent = await buildVoiceShortcutStorageEvent({
      text: '打开今天日志',
      startedAtMs: 1_700_000_000_123,
      targetScope: 'agent-chat',
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-1',
      },
    });

    expect(externalWindowEvent.id).not.toBe(agentChatEvent.id);
  });
});
