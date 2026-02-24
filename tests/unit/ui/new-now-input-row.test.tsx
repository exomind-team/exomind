import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NewNowInputRow } from '@/ui/new/components/NewNowInputRow';

const { mockReadClipboardText, mockToast } = vi.hoisted(() => ({
  mockReadClipboardText: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getClipboardService: () => ({
    readText: mockReadClipboardText,
    isAvailable: () => true,
  }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: mockToast,
}));

describe('NewNowInputRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReadClipboardText.mockReset();
    mockToast.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('submits text by send button and clears input', () => {
    const onSend = vi.fn();
    render(<NewNowInputRow onSend={onSend} placeholder="输入内容记录事件..." />);

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '像素级复刻输入行' } });

    const sendButton = screen.getByTestId('new-now-send-button');
    fireEvent.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('像素级复刻输入行');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('inserts clipboard text via clipboard service', async () => {
    mockReadClipboardText.mockResolvedValue({ ok: true, text: '服务层剪贴板文本' });

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
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

  it('shows secure-context guidance from clipboard service', async () => {
    mockReadClipboardText.mockResolvedValue({
      ok: false,
      reason: 'insecure-context',
      title: '当前页面不支持读取剪贴板',
      description: '请改用 localhost 或 https 访问；http://局域网IP 通常会被浏览器限制读取剪贴板。',
      error: new Error('secure context'),
    });

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-input-inline-button'));
    });
    expect(mockToast).toHaveBeenCalledWith({
        title: '当前页面不支持读取剪贴板',
        description: '请改用 localhost 或 https 访问；http://局域网IP 通常会被浏览器限制读取剪贴板。',
        variant: 'destructive',
    });
    expect(screen.getByText('未粘贴')).toBeInTheDocument();
    expect(screen.getByTestId('new-now-input-inline-button').className).toContain('text-red-500');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('未粘贴')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-now-input-inline-button').className).not.toContain('text-red-500');
  });
});
