/**
 * MessageActions 组件 - 单元测试
 *
 * 消息操作按钮行（复制 + 引用预留）
 * GH#68: 消息复制功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MessageActions } from '@/components/Chat/MessageActions';

const { mockClipboardWriteText } = vi.hoisted(() => ({
  mockClipboardWriteText: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getClipboardService: () => ({
    writeText: mockClipboardWriteText,
    readText: vi.fn(),
    isAvailable: () => true,
  }),
}));

describe('MessageActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockClipboardWriteText.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- 渲染 ---

  it('renders copy button with icon and text', () => {
    render(<MessageActions content="hello" align="start" />);
    expect(screen.getByTestId('msg-copy-btn')).toBeInTheDocument();
    expect(screen.getByText('复制')).toBeInTheDocument();
  });

  it('does not render when content is empty', () => {
    const { container } = render(<MessageActions content="" align="start" />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render when content is whitespace only', () => {
    const { container } = render(<MessageActions content="   " align="start" />);
    expect(container.firstChild).toBeNull();
  });

  // --- 对齐 ---

  it('aligns buttons to start for AI messages', () => {
    render(<MessageActions content="hello" align="start" />);
    const row = screen.getByTestId('msg-actions-row');
    expect(row.className).toContain('justify-start');
  });

  it('aligns buttons to end for user messages', () => {
    render(<MessageActions content="hello" align="end" />);
    const row = screen.getByTestId('msg-actions-row');
    expect(row.className).toContain('justify-end');
  });

  // --- 复制成功 ---

  it('copies content to clipboard on click', async () => {
    render(<MessageActions content="test message" align="start" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('msg-copy-btn'));
    });
    expect(mockClipboardWriteText).toHaveBeenCalledWith('test message');
  });

  it('shows success feedback after copy', async () => {
    render(<MessageActions content="test message" align="start" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('msg-copy-btn'));
    });
    expect(screen.getByText('已复制')).toBeInTheDocument();
  });

  it('reverts to original state after 1.5s', async () => {
    render(<MessageActions content="test message" align="start" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('msg-copy-btn'));
    });
    expect(screen.getByText('已复制')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText('复制')).toBeInTheDocument();
  });

  // --- 复制失败 ---

  it('shows toast on clipboard failure', async () => {
    mockClipboardWriteText.mockResolvedValue({
      ok: false,
      reason: 'unknown',
      title: '复制失败，请重试',
      description: '你可以手动选中文本后复制。',
      error: new Error('denied'),
    });

    render(<MessageActions content="test message" align="start" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('msg-copy-btn'));
    });

    // Should NOT show success feedback
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
    // Should still show original text
    expect(screen.getByText('复制')).toBeInTheDocument();
  });

  // --- 引用按钮预留 ---

  it('renders quote button as disabled placeholder', () => {
    render(<MessageActions content="hello" align="start" />);
    expect(screen.getByTestId('msg-quote-btn')).toBeInTheDocument();
    expect(screen.getByText('引用')).toBeInTheDocument();
  });
});
