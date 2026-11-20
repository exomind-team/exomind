import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { BetaApiError, type BetaQuery } from '@/beta/client';
import type { BetaTimelineItem, BetaTimelinePage } from '@/beta/timeblocks-types';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

type PeriodQuery = {
  from_ms: number;
  to_ms: number;
  before?: number;
  through?: number;
  limit?: number;
  search?: string;
  tag?: string;
};

const emptyPage = (highwater = 0, next_before: number | null = null): BetaTimelinePage => ({
  items: [],
  highwater,
  next_before,
});

function captureItem(eventId: string, text: string, localSeq: number): BetaTimelineItem {
  return {
    kind: 'capture',
    record: {
      event_id: eventId,
      profile_id: 'p',
      device_id: 'device-a',
      author_id: 'author-a',
      author_kind: 'human',
      occurred_at_ms: 1_770_000_000_000,
      text,
      tags: [],
      digest: 'a'.repeat(64),
      local_seq: localSeq,
    },
  };
}

function periodClient() {
  const base = fakeClient();
  const timelinePage = vi.fn(async (_profileId: string, _query: BetaQuery): Promise<BetaTimelinePage> => emptyPage());
  const timelinePeriodPage = vi.fn(
    async (_profileId: string, _query: PeriodQuery): Promise<BetaTimelinePage> =>
      emptyPage(42, 12),
  );
  return Object.assign(base, { timelinePage, timelinePeriodPage });
}

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const hadBetaUi = document.documentElement.classList.contains('beta-ui');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.classList.add('beta-ui');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: asyncDraftLocks(),
  });
});

afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  if (!hadBetaUi) document.documentElement.classList.remove('beta-ui');
  vi.useRealTimers();
});

describe('Beta period history wiring', () => {
  it('keeps an older archive record in the default all-history view and opts into a period only on selection', async () => {
    const user = userEvent.setup();
    const client = periodClient();
    client.timelinePage.mockResolvedValueOnce({
      items: [captureItem('archive-event', 'older archive record', 1)],
      highwater: 1,
      next_before: null,
    });
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);

    expect(await screen.findByText('older archive record')).toBeInTheDocument();
    expect(client.timelinePage).toHaveBeenCalledTimes(1);
    expect(client.timelinePeriodPage).not.toHaveBeenCalled();
    const allQuery = client.timelinePage.mock.calls[0]?.[1];
    expect(allQuery).not.toHaveProperty('from_ms');
    expect(allQuery).not.toHaveProperty('to_ms');

    const group = await screen.findByRole('group', { name: '浏览周期' });
    const all = within(group).getByRole('button', { name: '全部' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    const day = within(group).getByRole('button', { name: '日' });
    expect(day).toHaveAttribute('aria-pressed', 'false');
    await user.click(day);
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(1));
    const selected = client.timelinePeriodPage.mock.calls[0]?.[1];
    expect(selected?.from_ms).toBeLessThan(selected?.to_ms ?? 0);
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(day).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads one bounded page and exposes themed, keyboard and touch period controls', async () => {
    const user = userEvent.setup();
    const client = periodClient();
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);

    const group = await screen.findByRole('group', { name: '浏览周期' });
    expect(client.timelinePeriodPage).not.toHaveBeenCalled();
    await user.click(within(group).getByRole('button', { name: '日' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(1));
    expect(client.timelinePage).toHaveBeenCalledTimes(1);
    expect(client.eventsPage).not.toHaveBeenCalled();

    const [profileId, query] = client.timelinePeriodPage.mock.calls[0]!;
    expect(profileId).toBe('p');
    expect(query.from_ms).toBeLessThan(query.to_ms);
    expect(query.limit).toBe(100);
    expect(query.before).toBeUndefined();
    expect(query.through).toBeUndefined();

    const day = within(group).getByRole('button', { name: '日' });
    expect(day).toHaveAttribute('aria-pressed', 'true');
    expect(group.querySelector('[title]')).toBeNull();
    expect(screen.getByLabelText('记录历史').closest('.beta-ui')).not.toBeNull();
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveClass('focus-visible:ring-1');
    }

    const week = within(group).getByRole('button', { name: '周' });
    week.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(2));

    const next = screen.getByRole('button', { name: '下一个周期' });
    await user.pointer([
      { keys: '[TouchA>]', target: next },
      { keys: '[/TouchA]' },
    ]);
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(3));
  });

  it('combines search and tag, pins older pages, and resets the snapshot on a new window', async () => {
    const user = userEvent.setup();
    const client = periodClient();
    client.timelinePeriodPage.mockImplementation(async (_profileId, query) =>
      emptyPage(77, query.before === undefined ? 12 : null),
    );
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);

    const group = await screen.findByRole('group', { name: '浏览周期' });
    expect(client.timelinePeriodPage).not.toHaveBeenCalled();
    await user.click(within(group).getByRole('button', { name: '日' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(1));
    await user.click(within(group).getByRole('button', { name: '周' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(2));
    const week = client.timelinePeriodPage.mock.calls.at(-1)?.[1];
    expect(week?.before).toBeUndefined();
    expect(week?.through).toBeUndefined();

    await user.click(screen.getByRole('button', { name: '检索记录' }));
    await user.type(screen.getByRole('textbox', { name: '搜索记录' }), 'needle');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() =>
      expect(client.timelinePeriodPage.mock.calls.at(-1)?.[1].search).toBe('needle'),
    );

    await user.type(screen.getByLabelText('按标签筛选记录'), 'focus');
    await user.click(screen.getByRole('button', { name: '按标签筛选' }));
    await waitFor(() =>
      expect(client.timelinePeriodPage.mock.calls.at(-1)?.[1].tag).toBe('focus'),
    );
    const selected = client.timelinePeriodPage.mock.calls.at(-1)?.[1];
    expect(selected?.search).toBe('needle');
    expect(selected?.from_ms).toBe(week?.from_ms);
    expect(selected?.to_ms).toBe(week?.to_ms);
    expect(await screen.findByText('标签仅筛选记录；时间块与回顾仍按时间范围显示')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '加载更早记录' }));
    await waitFor(() =>
      expect(client.timelinePeriodPage.mock.calls.at(-1)?.[1].before).toBe(12),
    );
    const older = client.timelinePeriodPage.mock.calls.at(-1)?.[1];
    expect(older?.through).toBe(77);
    expect(older?.from_ms).toBe(selected?.from_ms);
    expect(older?.to_ms).toBe(selected?.to_ms);
    expect(older?.search).toBe('needle');
    expect(older?.tag).toBe('focus');

    await user.click(within(group).getByRole('button', { name: '月' }));
    await waitFor(() => {
      const next = client.timelinePeriodPage.mock.calls.at(-1)?.[1];
      expect(next?.from_ms).not.toBe(older?.from_ms);
      expect(next?.before).toBeUndefined();
      expect(next?.through).toBeUndefined();
      expect(next?.search).toBe('needle');
      expect(next?.tag).toBe('focus');
    });
  });

  it('clears a tag within the current window after a period change without restoring the old page', async () => {
    const user = userEvent.setup();
    const client = periodClient();
    let sequence = 0;
    const clearedWindow = deferred<BetaTimelinePage>();
    client.timelinePeriodPage.mockImplementation(async (_profileId, query) => {
      sequence += 1;
      if (sequence === 4) return clearedWindow.promise;
      const kind = query.tag ? 'tagged' : 'untagged';
      const text = kind + ' period ' + query.from_ms;
      return {
        items: [captureItem('period-event-' + sequence, text, sequence)],
        highwater: sequence,
        next_before: null,
      };
    });
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);

    const group = await screen.findByRole('group', { name: '浏览周期' });
    await user.click(within(group).getByRole('button', { name: '日' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(1));
    const dayWindow = client.timelinePeriodPage.mock.calls[0]?.[1];

    await user.click(screen.getByRole('button', { name: '检索记录' }));
    await user.type(screen.getByLabelText('按标签筛选记录'), 'focus');
    await user.click(screen.getByRole('button', { name: '按标签筛选' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(2));
    expect(client.timelinePeriodPage.mock.calls.at(-1)?.[1].tag).toBe('focus');

    await user.click(within(group).getByRole('button', { name: '周' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(3));
    const weekWindow = client.timelinePeriodPage.mock.calls.at(-1)?.[1];
    expect(weekWindow?.to_ms).not.toBe(dayWindow?.to_ms);
    expect(weekWindow?.tag).toBe('focus');

    await user.click(screen.getByRole('button', { name: '清除标签' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(4));
    const cleared = client.timelinePeriodPage.mock.calls.at(-1)?.[1];
    expect(cleared?.tag).toBeUndefined();
    expect(cleared?.from_ms).toBe(weekWindow?.from_ms);
    expect(cleared?.to_ms).toBe(weekWindow?.to_ms);
    expect(cleared?.before).toBeUndefined();
    expect(cleared?.through).toBeUndefined();
    expect(screen.queryByText('untagged period ' + dayWindow?.from_ms)).not.toBeInTheDocument();
    expect(screen.queryByText('tagged period ' + dayWindow?.from_ms)).not.toBeInTheDocument();
    await act(async () => {
      clearedWindow.resolve({
        items: [captureItem('cleared-week-event', 'untagged period ' + weekWindow?.from_ms, 4)],
        highwater: 4,
        next_before: null,
      });
    });
    expect(await screen.findByText('untagged period ' + weekWindow?.from_ms)).toBeInTheDocument();
  });

  it('drops a late old-window response and preserves the unsent draft and reading offset', async () => {
    const user = userEvent.setup();
    const client = periodClient();
    const oldWindow = deferred<BetaTimelinePage>();
    const newWindow = deferred<BetaTimelinePage>();
    client.timelinePeriodPage
      .mockReturnValueOnce(oldWindow.promise)
      .mockReturnValueOnce(newWindow.promise);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);

    const group = await screen.findByRole('group', { name: '浏览周期' });
    expect(client.timelinePeriodPage).not.toHaveBeenCalled();
    await user.click(within(group).getByRole('button', { name: '日' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(1));
    const draft = screen.getByRole('textbox', { name: '记录当下' });
    fireEvent.change(draft, { target: { value: 'unsent note remains' } });
    const history = screen.getByLabelText('记录历史');
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 200 },
    });
    history.scrollTop = 300;
    fireEvent.scroll(history);

    await user.click(within(group).getByRole('button', { name: '周' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(2));
    await act(async () => {
      newWindow.resolve({
        items: [captureItem('week-event', 'week-window record', 8)],
        highwater: 8,
        next_before: null,
      });
    });
    expect(await screen.findByText('week-window record')).toBeInTheDocument();

    await act(async () => {
      oldWindow.resolve({
        items: [captureItem('day-event', 'stale day record', 7)],
        highwater: 7,
        next_before: null,
      });
    });
    expect(screen.queryByText('stale day record')).not.toBeInTheDocument();
    expect(draft).toHaveValue('unsent note remains');
    expect(history.scrollTop).toBe(300);
  });

  it('distinguishes an empty window from a read or budget error', async () => {
    const user = userEvent.setup();
    const client = periodClient();
    client.timelinePeriodPage.mockResolvedValueOnce(emptyPage(0, null));
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);

    const group = await screen.findByRole('group', { name: '浏览周期' });
    expect(client.timelinePeriodPage).not.toHaveBeenCalled();
    await user.click(within(group).getByRole('button', { name: '日' }));
    await waitFor(() => expect(client.timelinePeriodPage).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('此时间范围没有记录')).toBeInTheDocument();
    client.timelinePeriodPage.mockRejectedValueOnce(new Error('普通读取失败'));
    await user.click(screen.getByRole('button', { name: '下一个周期' }));
    expect(await screen.findByText('普通读取失败')).toBeInTheDocument();

    client.timelinePeriodPage.mockRejectedValueOnce(
      new BetaApiError('timeline_period_budget_exceeded', '窗口记录较多，请缩小时间范围'),
    );
    await user.click(screen.getByRole('button', { name: '下一个周期' }));
    expect(await screen.findByText('窗口记录较多，请缩小时间范围')).toBeInTheDocument();
    expect(screen.queryByText('还没有记录')).not.toBeInTheDocument();
    expect(screen.queryByText('请添加文字或标签筛选后重试。')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回全部历史' }));
    await waitFor(() => expect(client.timelinePage).toHaveBeenCalledTimes(2));
    expect(client.timelinePeriodPage).toHaveBeenCalledTimes(3);
    const allQuery = client.timelinePage.mock.calls.at(-1)?.[1];
    expect(allQuery).not.toHaveProperty('from_ms');
    expect(allQuery).not.toHaveProperty('to_ms');
    expect(within(group).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  });
});
