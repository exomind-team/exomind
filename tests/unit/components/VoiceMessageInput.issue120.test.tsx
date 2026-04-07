import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const { startVoiceSpy } = vi.hoisted(() => ({
  startVoiceSpy: vi.fn(),
}));

vi.mock('@/components/VoiceInputButton', async () => {
  const React = await import('react');
  return {
    VoiceInputButton: React.forwardRef((_props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        start: () => startVoiceSpy(),
      }));
      return <button type="button" data-testid="voice-input-button-mock">🎤</button>;
    }),
  };
});

import { VoiceMessageInput, type VoiceMessageInputHandle } from '@/components/VoiceMessageInput';

describe('VoiceMessageInput Issue-120 behaviors', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('pressing Ctrl+Enter on empty textarea should start voice recording', () => {
    const onSend = vi.fn();
    render(<VoiceMessageInput onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('event-input-textarea');
    (textarea as HTMLTextAreaElement).focus();
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(startVoiceSpy).toHaveBeenCalledTimes(1);
    expect(textarea).not.toHaveFocus();
  });

  it('pressing Ctrl+Enter with content should send instead of starting voice', async () => {
    const onSend = vi.fn();
    render(<VoiceMessageInput onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('event-input-textarea');
    fireEvent.change(textarea, { target: { value: '测试事件' } });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith('测试事件');
    expect(startVoiceSpy).not.toHaveBeenCalled();
  });

  it('pressing Enter without Ctrl should not trigger quick send', () => {
    const onSend = vi.fn();
    render(<VoiceMessageInput onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('event-input-textarea');
    fireEvent.change(textarea, { target: { value: '测试事件' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect(startVoiceSpy).not.toHaveBeenCalled();
  });

  it('pressing repeated Ctrl+Enter should only send once（按住快捷发送键不应重复提交）', async () => {
    const onSend = vi.fn();
    render(<VoiceMessageInput onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('event-input-textarea');
    fireEvent.change(textarea, { target: { value: '桌面重复提交保护' } });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true, repeat: true });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('桌面重复提交保护');
  });

  it('prevents duplicate submit while desktop send is pending（桌面输入发送未完成前不应重入）', async () => {
    let resolveSend: (() => void) | null = null;
    const onSend = vi.fn(() => new Promise<void>((resolve) => {
      resolveSend = resolve;
    }));
    render(<VoiceMessageInput onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('event-input-textarea');
    fireEvent.change(textarea, { target: { value: '桌面 pending 去重' } });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend?.();
      await Promise.resolve();
    });
  });

  it('pressing Escape should blur the textarea', () => {
    const onSend = vi.fn();
    render(<VoiceMessageInput onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('event-input-textarea');
    (textarea as HTMLTextAreaElement).focus();
    expect(textarea).toHaveFocus();

    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

    expect(textarea).not.toHaveFocus();
  });

  it('supports appending draft text through the imperative handle（支持通过实例句柄追加草稿文本）', () => {
    const onSend = vi.fn();
    const ref = React.createRef<VoiceMessageInputHandle>();

    render(<VoiceMessageInput ref={ref} onSend={onSend} placeholder="输入内容记录事件..." />);

    act(() => {
      ref.current?.appendText('第一段');
      ref.current?.appendText('第二段');
    });

    expect(screen.getByTestId('event-input-textarea')).toHaveValue('第一段 第二段');
  });
});
