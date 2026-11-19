import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BetaMessageActions,
  BetaMessageLocationBoundary,
  BetaMessageReferenceDraft,
  BetaMessageReferenceLinks,
} from '@/beta/BetaMessageActions';
import { buildBetaMessageReferenceLine, buildBetaMessageReferenceUri } from '@/beta/message-references';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const PRIVATE_BODY = '原消息里的私人文字';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Beta message actions', () => {
  it('copies the original body exactly and gives a real clipboard acknowledgement', async () => {
    const writeClipboardText = vi.fn(async (_value: string) => undefined);
    render(<BetaMessageActions
      profileId={PROFILE}
      eventId={EVENT}
      content={PRIVATE_BODY + '\n保持换行'}
      align="start"
      writeClipboardText={writeClipboardText}
    />);

    expect(screen.queryByRole('button', { name: '复制消息正文' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('beta-message-action-feedback')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(screen.getByRole('button', { name: '复制消息正文' }));

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(PRIVATE_BODY + '\n保持换行'));
    expect(await screen.findByRole('status')).toHaveTextContent('已复制消息正文');
  });

  it('copies only the scoped URI and never exports the message body or secret-like fields', async () => {
    const writeClipboardText = vi.fn(async (_value: string) => undefined);
    render(<BetaMessageActions
      profileId={PROFILE}
      eventId={EVENT}
      content={PRIVATE_BODY + ' token=do-not-copy invite=do-not-copy'}
      align="end"
      writeClipboardText={writeClipboardText}
    />);

    fireEvent.click(screen.getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(screen.getByRole('button', { name: '复制消息链接' }));

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: EVENT })));
    const copied = writeClipboardText.mock.calls[0][0];
    expect(copied).not.toContain(PRIVATE_BODY);
    expect(copied).not.toMatch(/token|invite|do-not-copy/i);
  });

  it('keeps the latest rapid clipboard acknowledgement and reports failures without success wording', async () => {
    let resolveFirst: (() => void) | undefined;
    let rejectSecond: ((error: Error) => void) | undefined;
    const writeClipboardText = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSecond = reject; }));
    render(<BetaMessageActions
      profileId={PROFILE}
      eventId={EVENT}
      content={PRIVATE_BODY}
      align="start"
      writeClipboardText={writeClipboardText}
    />);

    fireEvent.click(screen.getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(screen.getByRole('button', { name: '复制消息正文' }));
    fireEvent.click(screen.getByRole('button', { name: '复制消息链接' }));
    await act(async () => { resolveFirst?.(); });
    expect(screen.getByRole('status')).toHaveTextContent('正在复制消息链接');
    await act(async () => { rejectSecond?.(new Error('permission denied')); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/复制.*失败/));
    expect(screen.getByRole('alert')).not.toHaveTextContent('已复制');
  });

  it('does not show a prior message clipboard acknowledgement after the row identity changes', async () => {
    let complete!: () => void;
    const writeClipboardText = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const view = render(<BetaMessageActions profileId={PROFILE} eventId={EVENT} content={PRIVATE_BODY} align="start" writeClipboardText={writeClipboardText}/>);
    fireEvent.click(screen.getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(screen.getByRole('button', { name: '复制消息正文' }));
    view.rerender(<BetaMessageActions profileId={PROFILE} eventId="33333333-3333-4333-8333-333333333333" content="另一条合成消息" align="start" writeClipboardText={writeClipboardText}/>);
    await act(async () => { complete(); });
    expect(screen.queryByTestId('beta-message-action-feedback')).not.toBeInTheDocument();
  });

  it('progressively reveals keyboard and touch reachable actions with readable labels', async () => {
    const onQuote = vi.fn();
    render(<BetaMessageActions profileId={PROFILE} eventId={EVENT} content={PRIVATE_BODY} align="end" onQuote={onQuote} />);

    const toggle = screen.getByRole('button', { name: '更多消息操作' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.className).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(toggle.className).toContain('[@media(pointer:coarse)]:opacity-100');
    const user = userEvent.setup();
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const quote = screen.getByRole('button', { name: '引用消息' });
    expect(quote.tagName).toBe('BUTTON');
    expect(quote.className).toContain('min-h-9');
    expect(quote.className).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(quote.className).toContain('touch-manipulation');
    expect(quote.className).toContain('focus-visible:ring-1');
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(quote);
    await user.keyboard('{Enter}');
    expect(onQuote).toHaveBeenNthCalledWith(1, { profileId: PROFILE, eventId: EVENT, text: PRIVATE_BODY });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '引用消息' }));
    expect(onQuote).toHaveBeenNthCalledWith(2, { profileId: PROFILE, eventId: EVENT, text: PRIVATE_BODY });
  });

  it('shows user-visible draft references and exposes separate open and remove actions', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const line = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'Readable source sentence' });
    render(<BetaMessageReferenceDraft
      value={line + '\nmy newer note'}
      onOpen={onOpen}
      onRemove={onRemove}
      sourceLabel={() => '工作站'}
    />);

    expect(screen.getByRole('region', { name: '草稿中的消息引用' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '引用如何保存' }));
    expect(screen.getByText(/可见 Markdown 行.*不会变成消息元数据/)).toBeInTheDocument();
    expect(screen.getByText('Readable source sentence')).toBeInTheDocument();
    expect(screen.getByText('来自 工作站')).toBeInTheDocument();
    expect(screen.queryByText(PROFILE)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打开引用原文/ }));
    fireEvent.click(screen.getByRole('button', { name: /移除引用/ }));
    expect(onOpen).toHaveBeenCalledWith({ profileId: PROFILE, eventId: EVENT });
    expect(onRemove).toHaveBeenCalledWith({ profileId: PROFILE, eventId: EVENT });
  });

  it('renders references from a saved message as explicit, scoped open actions', () => {
    const onOpen = vi.fn();
    const line = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'Readable source sentence' });
    render(<BetaMessageReferenceLinks value={line} onOpen={onOpen} />);

    expect(screen.getByRole('region', { name: '消息中的引用原文' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '引用原文说明' }));
    expect(screen.getByText(/来自记录正文中的 Markdown 行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打开引用原文/ }));
    expect(onOpen).toHaveBeenCalledWith({ profileId: PROFILE, eventId: EVENT });
  });

  it('keeps an explicit return seam for the original reading position and the latest record', () => {
    const onReturnToReadingPosition = vi.fn();
    const onReturnToLatest = vi.fn();
    render(<BetaMessageLocationBoundary
      state={{ kind: 'found', pagesRead: 3, source: 'pages', highwater: 30 }}
      onReturnToReadingPosition={onReturnToReadingPosition}
      onReturnToLatest={onReturnToLatest}
    />);

    const result = screen.getByRole('region', { name: '引用原文定位结果' });
    expect(result).toHaveTextContent('已找到引用原文');
    expect(result).toHaveTextContent('原来的阅读位置仍可恢复');
    expect(screen.getByRole('button', { name: '查看查找范围' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '查看查找范围' }));
    expect(result).toHaveTextContent('固定历史快照 highwater 30');
    fireEvent.click(screen.getByRole('button', { name: '回到原阅读位置' }));
    fireEvent.click(screen.getByRole('button', { name: '回到最新记录' }));
    expect(onReturnToReadingPosition).toHaveBeenCalledOnce();
    expect(onReturnToLatest).toHaveBeenCalledOnce();
  });

  it('keeps the page limit clear and offers a direct way to load older records before retrying', () => {
    const onLoadOlderAndRetry = vi.fn();
    render(<BetaMessageLocationBoundary
      state={{ kind: 'not-found', pagesRead: 16, highwater: 500, limitReached: true }}
      onRetry={vi.fn()}
      onLoadOlderAndRetry={onLoadOlderAndRetry}
      onReturnToReadingPosition={vi.fn()}
      onReturnToLatest={vi.fn()}
    />);

    const boundary = screen.getByTestId('beta-message-location-boundary');
    expect(boundary).toHaveTextContent('当前档案中暂未找到引用原文');
    expect(boundary).toHaveTextContent('已检查 16 页');
    expect(screen.getByRole('button', { name: '查看查找范围' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '加载更早记录并重试' }));
    expect(onLoadOlderAndRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '查看查找范围' }));
    expect(boundary).toHaveTextContent('highwater 500');
    expect(boundary).toHaveTextContent('最多 16 页');
  });
});
