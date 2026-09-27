import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SignalDetailPage } from '@/ui/app/pages/agents/SignalDetailPage';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to?: string;
  }) => <a href={to} {...props}>{children}</a>,
  useParams: () => ({ signalId: 'signal-1' }),
}));

describe('SignalDetailPage loading continuity（信号详情页加载连续性）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps signal detail shell visible while loading（加载中也应保留网络页壳层）', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(<SignalDetailPage />);

    expect(screen.getByTestId('signal-detail-page')).toBeInTheDocument();
    expect(screen.getByTestId('signal-detail-header')).toBeInTheDocument();
    expect(screen.getByTestId('signal-detail-loading')).toBeInTheDocument();
    expect(screen.getByText('网络')).toBeInTheDocument();
    expect(screen.getByText('信号详情')).toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('exits loading when runtime requests never resolve（Runtime 请求长期无响应时应退出加载态）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(<SignalDetailPage />);

    expect(screen.getByTestId('signal-detail-loading')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3501);
    });

    expect(screen.queryByTestId('signal-detail-loading')).not.toBeInTheDocument();
  });
});
