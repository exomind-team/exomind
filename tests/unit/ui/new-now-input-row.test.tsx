import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewNowInputRow } from '@/ui/new/components/NewNowInputRow';

const { mockInvoke, mockToast } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: mockToast,
}));

describe('NewNowInputRow', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockToast.mockReset();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
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

  it('uses tauri clipboard command when running in tauri runtime', async () => {
    Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true });
    const mockReadText = vi.fn().mockResolvedValue('浏览器文本');
    vi.stubGlobal('navigator', {
      clipboard: { readText: mockReadText },
    });
    mockInvoke.mockResolvedValue('Tauri 文本');

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    fireEvent.click(screen.getByTestId('new-now-input-inline-button'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('plugin:clipboard-manager|read_text');
    });
    expect(mockReadText).not.toHaveBeenCalled();
    expect((screen.getByTestId('new-now-input-textarea') as HTMLTextAreaElement).value).toBe('Tauri 文本');
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('falls back to navigator clipboard on web runtime', async () => {
    const mockReadText = vi.fn().mockResolvedValue('Web 文本');
    vi.stubGlobal('navigator', {
      clipboard: { readText: mockReadText },
    });

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    fireEvent.click(screen.getByTestId('new-now-input-inline-button'));

    await waitFor(() => {
      expect(mockReadText).toHaveBeenCalledTimes(1);
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect((screen.getByTestId('new-now-input-textarea') as HTMLTextAreaElement).value).toBe('Web 文本');
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('shows toast when tauri and web clipboard reads both fail', async () => {
    Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true });
    mockInvoke.mockRejectedValue(new Error('tauri denied'));
    const mockReadText = vi.fn().mockRejectedValue(new Error('web denied'));
    vi.stubGlobal('navigator', {
      clipboard: { readText: mockReadText },
    });

    render(<NewNowInputRow onSend={vi.fn()} placeholder="输入内容记录事件..." />);
    fireEvent.click(screen.getByTestId('new-now-input-inline-button'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: '读取剪贴板失败，请重试',
        variant: 'destructive',
      });
    });
  });
});
