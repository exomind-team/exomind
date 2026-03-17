import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NowInputRow } from '@/ui/app/components/NowInputRow';

const {
  mockReadClipboardText,
  mockToast,
  startVoiceSpy,
  setLatestVoiceProps,
  getLatestVoiceProps,
  getVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
  getInputSendMode,
  subscribeInputSendModeChanges,
  resetVoiceTranscriptMode,
  emitVoiceTranscriptMode,
  resetInputSendMode,
  emitInputSendMode,
  mockPublishVoiceTranscriptSignal,
} = vi.hoisted(() => {
  let latestVoiceProps: any = null;
  let transcriptMode: 'insert' | 'direct-send' = 'insert';
  let transcriptListeners: Array<(nextMode: 'insert' | 'direct-send') => void> = [];
  let inputSendMode: 'enter-send' | 'ctrl-enter-send' = 'ctrl-enter-send';
  let inputSendListeners: Array<(nextMode: 'enter-send' | 'ctrl-enter-send') => void> = [];
  return {
    mockReadClipboardText: vi.fn(),
    mockToast: vi.fn(),
    startVoiceSpy: vi.fn(),
    setLatestVoiceProps: (props: any) => {
      latestVoiceProps = props;
    },
    getLatestVoiceProps: () => latestVoiceProps,
    getVoiceTranscriptSendMode: vi.fn(() => transcriptMode),
    subscribeVoiceTranscriptSendModeChanges: vi.fn((listener: (nextMode: 'insert' | 'direct-send') => void) => {
      transcriptListeners.push(listener);
      return () => {
        transcriptListeners = transcriptListeners.filter((item) => item !== listener);
      };
    }),
    getInputSendMode: vi.fn(() => inputSendMode),
    subscribeInputSendModeChanges: vi.fn((listener: (nextMode: 'enter-send' | 'ctrl-enter-send') => void) => {
      inputSendListeners.push(listener);
      return () => {
        inputSendListeners = inputSendListeners.filter((item) => item !== listener);
      };
    }),
    mockPublishVoiceTranscriptSignal: vi.fn(),
    resetVoiceTranscriptMode: () => {
      transcriptMode = 'insert';
      transcriptListeners = [];
    },
    resetInputSendMode: () => {
      inputSendMode = 'ctrl-enter-send';
      inputSendListeners = [];
    },
    emitVoiceTranscriptMode: (nextMode: 'insert' | 'direct-send') => {
      transcriptMode = nextMode;
      transcriptListeners.forEach((listener) => listener(nextMode));
    },
    emitInputSendMode: (nextMode: 'enter-send' | 'ctrl-enter-send') => {
      inputSendMode = nextMode;
      inputSendListeners.forEach((listener) => listener(nextMode));
    },
  };
});

vi.mock('@/components/VoiceInputButton', async () => {
  const React = await import('react');
  return {
    VoiceInputButton: React.forwardRef((props: any, ref: any) => {
      setLatestVoiceProps(props);
      React.useImperativeHandle(ref, () => ({
        start: () => startVoiceSpy(),
      }));
      return <button type="button" data-testid="new-now-voice-button-mock">voice</button>;
    }),
  };
});

vi.mock('@/lib/services', () => ({
  getClipboardService: () => ({
    readText: mockReadClipboardText,
    isAvailable: () => true,
  }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: mockToast,
}));

vi.mock('@/config/voice-transcript-send-mode', () => ({
  getVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
}));

vi.mock('@/config/input-send-mode', () => ({
  getInputSendMode,
  subscribeInputSendModeChanges,
}));

vi.mock('@/lib/services/voice-signal.service', () => ({
  publishVoiceTranscriptSignal: mockPublishVoiceTranscriptSignal,
}));

describe('NowInputRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockReadClipboardText.mockReset();
    mockToast.mockReset();
    startVoiceSpy.mockReset();
    getVoiceTranscriptSendMode.mockClear();
    subscribeVoiceTranscriptSendModeChanges.mockClear();
    getInputSendMode.mockClear();
    subscribeInputSendModeChanges.mockClear();
    mockPublishVoiceTranscriptSignal.mockReset();
    mockPublishVoiceTranscriptSignal.mockResolvedValue(undefined);
    resetVoiceTranscriptMode();
    resetInputSendMode();
    setLatestVoiceProps(null);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('submits text by send button and clears input', () => {
    const onSend = vi.fn();
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '像素级复刻输入行' } });

    const sendButton = screen.getByTestId('new-now-send-button');
    fireEvent.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('像素级复刻输入行');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('renders voice button and starts voice recording by ref handle', () => {
    const ref = React.createRef<{ startVoiceRecording: () => void }>();
    render(<NowInputRow ref={ref} onSend={vi.fn()} placeholder="输入内容记录事件..." />);

    expect(screen.getByTestId('new-now-voice-button-mock')).toBeInTheDocument();
    expect(getLatestVoiceProps()).toMatchObject({
      showWaveform: true,
      showTimer: false,
      showPermissionUnlockButton: false,
      enableShortcut: true,
      size: 36,
      waveformColorVar: '--brand-accent',
    });
    expect(getLatestVoiceProps()?.idleButtonClassName).toContain('bg-[#EDECE9]');
    expect(getLatestVoiceProps()?.icons).toBeTruthy();
    act(() => {
      ref.current?.startVoiceRecording();
    });
    expect(startVoiceSpy).toHaveBeenCalledTimes(1);
  });

  it('starts voice recording when pressing Ctrl+Enter on empty textarea', () => {
    const onSend = vi.fn();
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    (textarea as HTMLTextAreaElement).focus();
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(startVoiceSpy).toHaveBeenCalledTimes(1);
    expect(textarea).not.toHaveFocus();
  });

  it('submits text when pressing Ctrl+Enter', () => {
    const onSend = vi.fn();
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: 'Ctrl+Enter 发送' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onSend).toHaveBeenCalledWith('Ctrl+Enter 发送');
  });

  it('does not submit when pressing Enter without Ctrl', () => {
    const onSend = vi.fn();
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '仅回车不发送' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect(startVoiceSpy).not.toHaveBeenCalled();
  });

  it('submits text when pressing Enter in auto-enter-send mode', () => {
    const onSend = vi.fn();
    emitInputSendMode('enter-send');
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '直接回车发送' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('直接回车发送');
  });

  it('keeps Shift+Enter as newline in auto-enter-send mode', () => {
    const onSend = vi.fn();
    emitInputSendMode('enter-send');
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '保留换行' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('inserts voice transcript into textarea', () => {
    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    const textarea = screen.getByTestId('new-now-input-textarea');

    fireEvent.change(textarea, { target: { value: '已有文本' } });
    act(() => {
      getLatestVoiceProps()?.onResult?.('语音识别内容');
    });

    expect((textarea as HTMLTextAreaElement).value).toBe('已有文本 语音识别内容');
  });

  it('sends voice transcript directly when mode is direct-send', () => {
    const onSend = vi.fn();
    emitVoiceTranscriptMode('direct-send');
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);
    const textarea = screen.getByTestId('new-now-input-textarea');

    act(() => {
      getLatestVoiceProps()?.onResult?.('  直接发送内容  ');
    });

    expect(onSend).toHaveBeenCalledWith('直接发送内容', ['voice']);
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('refocuses textarea after clicking send', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<NowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    const sendButton = screen.getByTestId('new-now-send-button');
    fireEvent.change(textarea, { target: { value: '发送后回焦' } });

    sendButton.focus();
    expect(sendButton).toHaveFocus();

    await act(async () => {
      fireEvent.click(sendButton);
      vi.advanceTimersByTime(20);
    });

    expect(onSend).toHaveBeenCalledWith('发送后回焦');
    expect(textarea).toHaveFocus();
  });

  it('publishes voice transcript signal when ASR returns text（语音结果会发布信号）', () => {
    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);

    act(() => {
      getLatestVoiceProps()?.onResult?.('  语音转写内容  ');
    });

    expect(mockPublishVoiceTranscriptSignal).toHaveBeenCalledWith(
      { text: '语音转写内容' },
      { source: 'frontend:now-input-row' }
    );
  });

  it('logs voice errors for troubleshooting', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);

    act(() => {
      getLatestVoiceProps()?.onError?.('麦克风权限被拒绝');
    });

    expect(errorSpy).toHaveBeenCalledWith('[ERROR]', '[new-now-input][voice] 麦克风权限被拒绝');
    errorSpy.mockRestore();
  });

  it('shows temporary "待开发" placeholder after attachment click', () => {
    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    fireEvent.click(screen.getByTestId('new-now-attachment-button'));

    expect(screen.getByText('待开发')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('待开发')).not.toBeInTheDocument();
  });

  it('inserts clipboard text via clipboard service', async () => {
    mockReadClipboardText.mockResolvedValue({ ok: true, text: '服务层剪贴板文本' });

    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-input-inline-button'));
    });
    expect(mockReadClipboardText).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('new-now-input-textarea') as HTMLTextAreaElement).value).toBe('服务层剪贴板文本');
    expect(screen.getByText('已粘贴')).toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('已粘贴')).not.toBeInTheDocument();
  });

  it('shows mapped "不支持" label for insecure-context', async () => {
    mockReadClipboardText.mockResolvedValue({
      ok: false,
      reason: 'insecure-context',
      title: '当前页面不支持读取剪贴板',
      description: '请改用 localhost 或 https 访问；http://局域网IP 通常会被浏览器限制读取剪贴板。',
      error: new Error('secure context'),
    });

    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-input-inline-button'));
    });
    expect(mockToast).toHaveBeenCalledWith({
        title: '当前页面不支持读取剪贴板',
        description: '请改用 localhost 或 https 访问；http://局域网IP 通常会被浏览器限制读取剪贴板。',
        variant: 'destructive',
    });
    expect(screen.getByText('不支持')).toBeInTheDocument();
    expect(screen.getByTestId('new-now-input-inline-button').className).toContain('text-red-500');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('不支持')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-now-input-inline-button').className).not.toContain('text-red-500');
  });

  it('shows mapped "无权限" label for permission-denied', async () => {
    mockReadClipboardText.mockResolvedValue({
      ok: false,
      reason: 'permission-denied',
      title: '浏览器阻止读取剪贴板',
      description: '请在站点权限中允许剪贴板读取后重试，或直接在输入框内手动粘贴。',
      error: new Error('permission denied'),
    });

    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-input-inline-button'));
    });
    expect(screen.getByText('无权限')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('无权限')).not.toBeInTheDocument();
  });

  it('falls back to "未粘贴" label for unknown reason', async () => {
    mockReadClipboardText.mockResolvedValue({
      ok: false,
      reason: 'unknown',
      title: '读取剪贴板失败，请重试',
      description: '你可以先点击输入框，再使用 Ctrl/Cmd+V（移动端长按）手动粘贴。',
      error: new Error('unknown'),
    });

    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-input-inline-button'));
    });
    expect(screen.getByText('未粘贴')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('未粘贴')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-now-input-inline-button').className).not.toContain('text-red-500');
  });
});
