import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const writeClipboardMock = vi.fn();
const publishVoiceTranscriptSignalMock = vi.fn();
const appendEventWithEcsReplicationMock = vi.fn();
const buildVoiceShortcutStorageEventMock = vi.fn();
const recordVolcanoUsageDurationMock = vi.fn();

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

vi.mock('@/config/volcano-usage-stats', () => ({
  recordVolcanoUsageDuration: (...args: unknown[]) => recordVolcanoUsageDurationMock(...args),
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
    recordVolcanoUsageDurationMock.mockReset();
  });

  it('publishes signal and defers auto-record persistence to signal bridge when auto-record is enabled', async () => {
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
    expect(buildVoiceShortcutStorageEventMock).not.toHaveBeenCalled();
    expect(appendEventWithEcsReplicationMock).not.toHaveBeenCalled();
  });

  it('does not append storage event immediately when signal publish succeeds（信号成功时不应前端直写事件日志）', async () => {
    const service = new VoiceShortcutService();
    (service as any).traceStartedAtMs = 1_700_000_000_000;
    (service as any).currentTraceId = 'trace-success-only-signal';
    (service as any).frozenForegroundWindowContext = {
      title: 'Cursor - ExoMind',
      processName: 'Cursor.exe',
    };

    await (service as any).handleResult(
      { text: '只走信号链路', confidence: 0.98, lang: 'zh-CN' },
      120,
      'MOSS',
    );

    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '只走信号链路' }),
      expect.objectContaining({
        captureSource: 'global-shortcut',
        traceId: 'trace-success-only-signal',
      }),
    );
    expect(appendEventWithEcsReplicationMock).not.toHaveBeenCalled();
  });

  it('restores captured foreground window before simulate_paste（粘贴前先恢复目标窗口焦点）', async () => {
    const service = new VoiceShortcutService();
    (service as any).traceStartedAtMs = 1_700_000_000_000;
    (service as any).currentTraceId = 'trace-focus-restore';
    (service as any).frozenForegroundWindowContext = {
      title: 'Cursor - ExoMind',
      processName: 'Cursor.exe',
      windowHandle: '4660',
    };

    await (service as any).handleResult(
      { text: '恢复焦点后粘贴', confidence: 0.98, lang: 'zh-CN' },
      120,
      'MOSS',
    );

    expect(invokeMock).toHaveBeenCalledWith('foreground_window_focus', {
      windowHandle: '4660',
    });
    const focusCallIndex = invokeMock.mock.calls.findIndex(([command]) => command === 'foreground_window_focus');
    const pasteCallIndex = invokeMock.mock.calls.findIndex(([command]) => command === 'simulate_paste');
    expect(focusCallIndex).toBeGreaterThanOrEqual(0);
    expect(pasteCallIndex).toBeGreaterThan(focusCallIndex);
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

  it('records volcano duration stats when provider is volcano（火山识别结果会累计本地时长）', async () => {
    const service = new VoiceShortcutService();
    (service as any).asrProvider = 'volcano';

    await (service as any).handleResult(
      { text: '火山统计', confidence: 0.97, lang: 'zh-CN', duration: 4_200 },
      66,
      '火山 2.0 小时版 · 双向流式优化版（推荐）',
    );

    expect(recordVolcanoUsageDurationMock).toHaveBeenCalledWith(4_200);
  });
});
