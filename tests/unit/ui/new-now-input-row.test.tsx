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

  it('shows temporary "待开发" placeholder after attachment click', () => {
    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    fireEvent.click(screen.getByTestId('new-now-attachment-button'));

    expect(screen.getByText('待开发')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('待开发')).not.toBeInTheDocument();
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

  it('shows mapped "不支持" label for insecure-context', async () => {
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

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
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

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
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
