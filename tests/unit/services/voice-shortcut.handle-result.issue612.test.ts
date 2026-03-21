import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const writeClipboardMock = vi.fn();
const publishVoiceTranscriptSignalMock = vi.fn();
const appendEventWithEcsReplicationMock = vi.fn();
const buildVoiceShortcutStorageEventMock = vi.fn();

const runtimeState = {
  voiceAutoRecordEnabled: true,
  voiceShortcutSendMode: 'insert-only' as 'insert-only' | 'auto-enter-send',
  interactionContext: null as null | {
    targetScope: string;
    agentContext?: {
      agentId?: string;
      agentName?: string;
      sessionId?: string;
    };
  },
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));

vi.mock('@/lib/services/clipboard.service', () => ({
  getClipboardService: () => ({
    writeText: (...args: unknown[]) => writeClipboardMock(...args),
  }),
}));

vi.mock('@/lib/services/voice-signal.service', () => ({
  publishVoiceTranscriptSignal: (...args: unknown[]) => publishVoiceTranscriptSignalMock(...args),
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: (...args: unknown[]) => appendEventWithEcsReplicationMock(...args),
}));

vi.mock('@/services/voice-shortcut-eventlog', () => ({
  buildVoiceShortcutStorageEvent: (...args: unknown[]) => buildVoiceShortcutStorageEventMock(...args),
}));

vi.mock('@/config/voice-auto-record', () => ({
  getVoiceAutoRecordEnabled: () => runtimeState.voiceAutoRecordEnabled,
}));

vi.mock('@/config/voice-shortcut-send-mode', () => ({
  getVoiceShortcutSendMode: () => runtimeState.voiceShortcutSendMode,
}));

vi.mock('@/lib/services/active-interaction-context.service', () => ({
  getActiveInteractionContextService: () => ({
    getContext: () => runtimeState.interactionContext,
  }),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  setConsoleMinLevel: vi.fn(),
}));

import { VoiceShortcutService } from '@/services/voice-shortcut.service';

describe('VoiceShortcutService handleResult (#612)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.voiceAutoRecordEnabled = true;
    runtimeState.voiceShortcutSendMode = 'insert-only';
    runtimeState.interactionContext = null;
    writeClipboardMock.mockResolvedValue({ ok: true, title: 'ok' });
    publishVoiceTranscriptSignalMock.mockResolvedValue(undefined);
    appendEventWithEcsReplicationMock.mockResolvedValue(undefined);
    buildVoiceShortcutStorageEventMock.mockResolvedValue({
      id: 'voice-event-1',
      content: '测试语音',
      type: 'voice',
      createdAt: '2026-03-21T00:00:00.000Z',
      metadata: {
        inputSource: 'voice',
      },
    });
    invokeMock.mockResolvedValue(null);
  });

  it('publishes signal and appends storage event when auto-record is enabled', async () => {
    runtimeState.interactionContext = {
      targetScope: 'agent-chat',
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-1',
      },
    };

    const service = new VoiceShortcutService();
    (service as any).traceStartedAtMs = 1_700_000_000_000;
    (service as any).currentTraceId = 'trace-1';
    (service as any).frozenForegroundWindowContext = {
      title: 'Cursor - ExoMind',
      processName: 'Cursor.exe',
    };

    await (service as any).handleResult(
      { text: '测试语音', confidence: 0.98, lang: 'zh-CN' },
      123,
      'MOSS',
    );

    expect(writeClipboardMock).toHaveBeenCalledWith('测试语音');
    expect(invokeMock).toHaveBeenCalledWith('simulate_paste');
    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '测试语音' }),
      expect.objectContaining({
        source: 'tauri:voice-shortcut',
        captureSource: 'global-shortcut',
        traceId: 'trace-1',
        targetScope: 'agent-chat',
        window: {
          title: 'Cursor - ExoMind',
          processName: 'Cursor.exe',
        },
        agentContext: {
          agentId: 'codex',
          agentName: 'Codex',
          sessionId: 'session-1',
        },
      }),
    );
    expect(buildVoiceShortcutStorageEventMock).toHaveBeenCalledWith(expect.objectContaining({
      text: '测试语音',
      startedAtMs: 1_700_000_000_000,
      targetScope: 'agent-chat',
      window: {
        title: 'Cursor - ExoMind',
        processName: 'Cursor.exe',
      },
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-1',
      },
    }));
    expect(appendEventWithEcsReplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'voice-event-1',
      content: '测试语音',
    }));
  });

  it('skips storage event append when auto-record is disabled', async () => {
    runtimeState.voiceAutoRecordEnabled = false;

    const service = new VoiceShortcutService();
    (service as any).frozenForegroundWindowContext = {
      title: 'Terminal',
      processName: 'WindowsTerminal.exe',
    };

    await (service as any).handleResult(
      { text: '关闭自动记录', confidence: 0.95, lang: 'zh-CN' },
      88,
      'MOSS',
    );

    expect(writeClipboardMock).toHaveBeenCalledWith('关闭自动记录');
    expect(invokeMock).toHaveBeenCalledWith('simulate_paste');
    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '关闭自动记录' }),
      expect.objectContaining({
        targetScope: 'external-window',
        window: {
          title: 'Terminal',
          processName: 'WindowsTerminal.exe',
        },
      }),
    );
    expect(buildVoiceShortcutStorageEventMock).not.toHaveBeenCalled();
    expect(appendEventWithEcsReplicationMock).not.toHaveBeenCalled();
  });
});
