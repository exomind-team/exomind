import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';
import { selectField } from './select-field';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import type { BetaClient, BetaEvent } from '@/beta/client';
import type { BetaTimelineItem } from '@/beta/timeblocks-types';
import { buildBetaMessageReferenceLine, buildBetaMessageReferenceUri } from '@/beta/message-references';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE = '44444444-4444-4444-8444-444444444444';
const EVENT = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function eventRecord(profileId: string, eventId: string, text: string, localSeq = 1): BetaEvent {
  return {
    event_id: eventId,
    profile_id: profileId,
    device_id: 'device-a',
    author_id: 'device-a',
    author_kind: 'human',
    occurred_at_ms: 1234,
    text,
    tags: [],
    digest: 'a'.repeat(64),
    local_seq: localSeq,
  };
}

function profileClient() {
  const client = fakeClient();
  client.profiles.mockResolvedValue([
    { profile_id: PROFILE, display_name: '当前档案' },
    { profile_id: OTHER_PROFILE, display_name: '另一档案' },
  ]);
  return client;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});

afterEach(() => {
  cleanup();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  localStorage.clear();
  sessionStorage.clear();
});

describe('Beta message actions in the record workspace', () => {
  it('copies the original body and scoped link, quotes into the current draft, and removes only that quote', async () => {
    const client = profileClient();
    const body = '原消息正文\n保留换行';
    client.eventsPage.mockResolvedValueOnce({ items: [eventRecord(PROFILE, EVENT, body)], next_before: null, highwater: 1 });
    const writeText = vi.fn(async (_value: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client as BetaClient} />);

    const editor = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(editor, { target: { value: '先写下的内容' } });
    const row = screen.getByTestId('new-mobile-user-message-row');
    fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(within(row).getByRole('button', { name: '复制消息正文' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(body));
    fireEvent.click(within(row).getByRole('button', { name: '复制消息链接' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: EVENT })));
    fireEvent.click(within(row).getByRole('button', { name: '引用消息' }));

    const referenceLine = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: body });
    expect(editor).toHaveValue(referenceLine + '\n先写下的内容');
    expect(screen.getByRole('region', { name: '草稿中的消息引用' })).toHaveTextContent('原消息正文');
    fireEvent.click(screen.getByRole('button', { name: '引用如何保存' }));
    expect(screen.getByText(/不会变成消息元数据/)).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: referenceLine + '\n期间继续输入的内容' } });
    fireEvent.click(screen.getByRole('button', { name: /从草稿移除引用/ }));
    expect(editor).toHaveValue('期间继续输入的内容');
    expect(screen.queryByRole('region', { name: '草稿中的消息引用' })).not.toBeInTheDocument();
  });

  it('does not read a different profile for a pasted URI and keeps the current draft and selection', async () => {
    localStorage.setItem('exomind:beta:workspace-layout', JSON.stringify({ version: 1, focus: 'expanded', records: 'collapsed', minimal: false }));
    const timelineEvent = vi.fn(async (_profileId: string, _eventId: string): Promise<BetaTimelineItem | null> => null);
    const client = { ...profileClient(), timelineEvent };
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    const editor = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const readsBefore = client.eventsPage.mock.calls.length;
    const uri = buildBetaMessageReferenceUri({ profileId: OTHER_PROFILE, eventId: TARGET });
    fireEvent.change(editor, { target: { value: 'keep this draft\n' + uri } });
    fireEvent.click(screen.getByRole('button', { name: /打开引用原文/ }));

    expect(await screen.findByText(/此引用属于另一个档案/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue(PROFILE);
    expect(editor).toHaveValue('keep this draft\n' + uri);
    expect(timelineEvent).not.toHaveBeenCalled();
    expect(client.eventsPage).toHaveBeenCalledTimes(readsBefore);
    expect(screen.getByLabelText('记录历史')).not.toBeVisible();
    expect(JSON.parse(localStorage.getItem('exomind:beta:workspace-layout') ?? '{}')).toMatchObject({ records: 'collapsed', minimal: false });
  });

  it('discards a late exact-read result after a profile switch without changing the new draft', async () => {
    const exactRead = deferred<BetaTimelineItem | null>();
    const timelineEvent = vi.fn(() => exactRead.promise);
    const client = { ...profileClient(), timelineEvent };
    const referenceLine = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: TARGET, text: '目标记录摘要' });
    client.eventsPage.mockResolvedValueOnce({ items: [eventRecord(PROFILE, EVENT, referenceLine)], next_before: null, highwater: 2 });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByRole('button', { name: /打开引用原文：目标记录摘要/ }));
    expect(await screen.findByText('正在定位引用原文…')).toBeInTheDocument();
    expect(timelineEvent).toHaveBeenCalledWith(PROFILE, TARGET);

    const profileSelect = screen.getByRole('combobox', { name: '当前档案' });
    await selectField(profileSelect, OTHER_PROFILE);
    await waitFor(() => expect(profileSelect).toHaveValue(OTHER_PROFILE));
    const newEditor = await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.change(newEditor, { target: { value: '新档案的输入' } });
    await act(async () => {
      exactRead.resolve({ kind: 'capture', record: eventRecord(PROFILE, TARGET, '迟到的旧档案原文', 1) });
      await exactRead.promise;
    });

    expect(newEditor).toHaveValue('新档案的输入');
    expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue(OTHER_PROFILE);
    expect(screen.queryByText('已找到引用原文')).not.toBeInTheDocument();
    expect(screen.queryByText('迟到的旧档案原文')).not.toBeInTheDocument();
  });

  it('shows an exact located record beside the current history and restores the original scroll offset', async () => {
    const target = { kind: 'capture' as const, record: eventRecord(PROFILE, TARGET, '定位到的原文', 1) };
    const timelineEvent = vi.fn(async () => target);
    const client = { ...profileClient(), timelineEvent };
    const referenceLine = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: TARGET, text: '可定位摘要' });
    client.eventsPage.mockResolvedValueOnce({ items: [eventRecord(PROFILE, EVENT, referenceLine, 2)], next_before: null, highwater: 2 });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    await screen.findByRole('textbox', { name: '记录当下' });
    const history = screen.getByLabelText('记录历史');
    await waitFor(() => expect(history).toHaveAttribute('aria-busy', 'false'));
    Object.defineProperties(history, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    history.scrollTop = 260;
    fireEvent.scroll(history);
    fireEvent.click(screen.getByRole('button', { name: /打开引用原文：可定位摘要/ }));

    const location = await screen.findByRole('region', { name: '引用原文定位结果' });
    expect(location).toHaveTextContent('已找到引用原文');
    expect(screen.getByRole('button', { name: '查看查找范围' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('定位到的原文')).toBeInTheDocument();
    expect(history.scrollTop).toBe(260);
    fireEvent.click(screen.getByRole('button', { name: '回到原阅读位置' }));
    await waitFor(() => expect(screen.queryByTestId('beta-message-location-boundary')).not.toBeInTheDocument());
    expect(history.scrollTop).toBe(260);
    expect(screen.getByText('可定位摘要')).toBeInTheDocument();
  });

  it.each([
    {mode:'collapsed',records:'collapsed',minimal:false,visibleBefore:false},
    {mode:'hidden',records:'hidden',minimal:false,visibleBefore:false},
    {mode:'minimal',records:'hidden',minimal:true,visibleBefore:true},
  ] as const)('opens a reference from $mode mode and restores the prior layout on return', async ({records,minimal,visibleBefore}) => {
    localStorage.setItem('exomind:beta:workspace-layout', JSON.stringify({ version: 1, focus: 'expanded', records, minimal }));
    const target = { kind: 'capture' as const, record: eventRecord(PROFILE, TARGET, '折叠视图中的原文', 1) };
    const timelineEvent = vi.fn(async () => target);
    const client = { ...profileClient(), timelineEvent };
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    const editor = await screen.findByRole('textbox', { name: '记录当下' });
    const history = screen.getByLabelText('记录历史');
    if(visibleBefore)expect(history).toBeVisible();else expect(history).not.toBeVisible();
    fireEvent.change(editor, { target: { value: buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: TARGET }) } });
    fireEvent.click(screen.getByRole('button', { name: /打开引用原文/ }));

    await waitFor(() => expect(screen.getByText('折叠视图中的原文')).toBeVisible());
    expect(history).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '回到原阅读位置' }));
    await waitFor(() => expect(screen.queryByTestId('beta-message-location-boundary')).not.toBeInTheDocument());
    if(visibleBefore)expect(history).toBeVisible();else expect(history).not.toBeVisible();
    expect(JSON.parse(localStorage.getItem('exomind:beta:workspace-layout') ?? '{}')).toMatchObject({ records, minimal });
  });
});
