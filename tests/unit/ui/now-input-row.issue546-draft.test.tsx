import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NowInputRow } from '@/ui/app/components/NowInputRow';

const {
  mockReadClipboardText,
  mockToast,
  startVoiceSpy,
  setLatestVoiceProps,
  getVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
  getInputSendMode,
  subscribeInputSendModeChanges,
  resetVoiceTranscriptMode,
  resetInputSendMode,
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
      latestVoiceProps = null;
      transcriptMode = 'insert';
      transcriptListeners = [];
    },
    resetInputSendMode: () => {
      inputSendMode = 'ctrl-enter-send';
      inputSendListeners = [];
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

describe('NowInputRow issue-546 draft cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockReadClipboardText.mockReset();
    mockToast.mockReset();
    startVoiceSpy.mockReset();
    mockPublishVoiceTranscriptSignal.mockReset();
    mockPublishVoiceTranscriptSignal.mockResolvedValue(undefined);
    resetVoiceTranscriptMode();
    resetInputSendMode();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores persisted draft when draftStorageKey is provided', () => {
    localStorage.setItem('exomind:draft:test-now-input', '未提交草稿');

    render(
      <NowInputRow
        onSend={vi.fn()}
        placeholder="输入内容记录事件..."
        draftStorageKey="exomind:draft:test-now-input"
      />,
    );

    expect(screen.getByTestId('new-now-input-textarea')).toHaveValue('未提交草稿');
  });

  it('persists draft after debounce and clears it after successful submit', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <NowInputRow
        onSend={onSend}
        placeholder="输入内容记录事件..."
        draftStorageKey="exomind:draft:test-now-input"
      />,
    );

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '等待提交的任务草稿' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem('exomind:draft:test-now-input')).toBe('等待提交的任务草稿');

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-send-button'));
    });

    expect(onSend).toHaveBeenCalledWith('等待提交的任务草稿');
    expect(textarea).toHaveValue('');
    expect(localStorage.getItem('exomind:draft:test-now-input')).toBeNull();
  });

  it('keeps draft cache when submit fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <NowInputRow
        onSend={onSend}
        placeholder="输入内容记录事件..."
        draftStorageKey="exomind:draft:test-now-input"
      />,
    );

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '失败后保留的草稿' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-send-button'));
    });

    expect(textarea).toHaveValue('失败后保留的草稿');
    expect(localStorage.getItem('exomind:draft:test-now-input')).toBe('失败后保留的草稿');
  });

  it('does not touch storage when draftStorageKey is omitted', () => {
    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);

    fireEvent.change(screen.getByTestId('new-now-input-textarea'), { target: { value: '纯内存输入' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const autoKey = localStorage.key(0);
    expect(autoKey).toContain('exomind:draft:now-input:');
    expect(localStorage.getItem(autoKey!)).toBe('纯内存输入');
  });

  it('skips storage when draftStorageKey is explicitly null', () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    render(<NowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." draftStorageKey={null} />);

    fireEvent.change(screen.getByTestId('new-now-input-textarea'), { target: { value: '禁用缓存' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
