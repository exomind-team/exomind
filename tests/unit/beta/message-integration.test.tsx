import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';
import { selectField } from './select-field';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import type { BetaClient, BetaEvent, BetaQuery } from '@/beta/client';
import type { BetaTimelineItem, BetaTimelinePage } from '@/beta/timeblocks-types';
import { buildBetaMessageReferenceLine, buildBetaMessageReferenceUri } from '@/beta/message-references';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE = '44444444-4444-4444-8444-444444444444';
const EVENT = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';
const DEVICE = '55555555-5555-4555-8555-555555555555';
const BLOCK = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);
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

function typedTimelineFact(kind: 'timeblock' | 'summary/1' | 'agent_summary/1'): BetaTimelineItem {
  if (kind === 'timeblock') return {
    kind,
    record: {
      event_id: TARGET, profile_id: PROFILE, device_id: DEVICE,
      source: { kind: 'human', author_id: DEVICE, owner_generation: null }, parents: [],
      occurred_at_ms: 1234, effective_at_ms: 1234,
      clock: { epoch_id: DEVICE, elapsed_ms: 0 },
      payload: { kind: 'action', action: { kind: 'pause', block_id: BLOCK } },
      digest: DIGEST, local_seq: 1,
    },
  } as unknown as BetaTimelineItem;
  if (kind === 'summary/1') return {
    kind,
    record: {
      event_id: TARGET, profile_id: PROFILE, device_id: DEVICE, author_id: DEVICE,
      task_id: '77777777-7777-4777-8777-777777777777', run_id: '88888888-8888-4888-8888-888888888888',
      attempt_id: '99999999-9999-4999-8999-999999999999', owner_generation: 1,
      owner_control_event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artifact_kind: 'review',
      snapshot: {
        selection: { block_ids: [], from_ms: 0, to_ms: 1234, selected_original_ids: [] },
        sources: [], feedback_ids: [], origin_heads: [], through: 1, input_encoded_bytes: 1, materials: [],
        coverage: { page_limit: false, input_byte_limit: false, omitted_source_ids: [], read_failures: [], missing_parents: [], metadata_only: [], unread_originals: [], remote_visibility: 'unknown' },
        digest: DIGEST,
      },
      output: {
        narrative: '保存的 AI 总结正文', evidence: [], read_original_ids: [],
        model: { provider: 'fixture', model: 'fixture', role_config_digest: DIGEST, request_input_digest: DIGEST, prompt_template: 'fixture', include_suggestions: false, max_output_tokens: 64, requested_model: 'fixture' },
        usage: { input_tokens: null, output_tokens: null, provider_request_id: null },
      },
      supersedes_artifact_id: null, occurred_at_ms: 1234, digest: DIGEST, local_seq: 1,
    },
  } as unknown as BetaTimelineItem;
  return {
    kind,
    record: {
      event_id: TARGET, profile_id: PROFILE, device_id: DEVICE,
      producer_agent_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', occurred_at_ms: 1234,
      snapshot: {
        observed_through: 1, sources: [{ event_id: EVENT, kind: 'capture', digest: DIGEST }],
        input_encoded_bytes: 1, materials: [],
        coverage: { scope: 'explicit_sources', source_delivery: 'not_attested', remote_visibility: 'unknown', unread_original_ids: [] },
        digest: DIGEST,
      },
      narrative: '外部 Agent 总结正文', evidence: [EVENT], digest: DIGEST, local_seq: 1,
    },
  } as unknown as BetaTimelineItem;
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
  it.each([
    { kind: 'timeblock' as const, body: '暂停时间块', label: '系统时间块' },
    { kind: 'summary/1' as const, body: '保存的 AI 总结正文', label: 'AI 总结' },
    { kind: 'agent_summary/1' as const, body: '外部 Agent 总结正文', label: '外部 Agent 回顾' },
  ])('uses the same $kind row for history actions and the location peek', async ({ kind, body, label }) => {
    const target = typedTimelineFact(kind);
    const sourceText = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: TARGET, text: '定位摘要' });
    const source = { kind: 'capture' as const, record: eventRecord(PROFILE, EVENT, sourceText, 2) };
    const timelinePage = vi.fn(async (_profileId: string, _query: BetaQuery): Promise<BetaTimelinePage> => ({
      items: [source, target], next_before: null, highwater: 2,
    }));
    const timelineEvent = vi.fn(async (_profileId: string, _eventId: string): Promise<BetaTimelineItem | null> => target);
    const client = { ...profileClient(), timelinePage, timelineEvent };
    const writeText = vi.fn(async (_value: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    const editor = await screen.findByRole('textbox', { name: '记录当下' });
    const history = screen.getByLabelText('记录历史');
    await waitFor(() => expect(history).toHaveAttribute('aria-busy', 'false'));
    const historyTarget = document.querySelector(`[data-event-id="${TARGET}"][data-timeline-kind="${kind}"]`) as HTMLElement;
    expect(historyTarget).toBeInTheDocument();
    fireEvent.click(within(historyTarget).getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(within(historyTarget).getByRole('button', { name: '复制消息正文' }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(1, body));
    fireEvent.click(within(historyTarget).getByRole('button', { name: '引用消息' }));
    expect(editor).toHaveValue(buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: TARGET, text: body, label }) + '\n');

    const sourceRow = document.querySelector(`[data-event-id="${EVENT}"]`) as HTMLElement;
    fireEvent.click(within(sourceRow).getByRole('button', { name: /在外心档案内回看原文：定位摘要/ }));
    const location = await screen.findByRole('region', { name: '外心档案内引用定位结果' });
    expect(location).toHaveTextContent('已在当前外心档案内找到引用原文');
    const sameFactRows = document.querySelectorAll(`[data-event-id="${TARGET}"][data-timeline-kind="${kind}"]`);
    expect(sameFactRows).toHaveLength(2);
    const peek = sameFactRows[0] as HTMLElement;
    fireEvent.click(within(peek).getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(within(peek).getByRole('button', { name: '复制消息正文' }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(2, body));
  });

  it('quotes an attachment-only capture by name while keeping empty body copy disabled', async () => {
    const client = profileClient();
    const attachment = {
      original_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sha256: 'b'.repeat(64), byte_length: 12, file_name: 'receipt.pdf', media_type: 'application/pdf',
    };
    const record = { ...eventRecord(PROFILE, EVENT, ''), originals: [attachment] };
    client.eventsPage.mockResolvedValueOnce({ items: [record], next_before: null, highwater: 1 });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client as BetaClient} />);

    const editor = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const row = screen.getByTestId('new-mobile-user-message-row');
    fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
    expect(within(row).getByRole('button', { name: '复制消息正文' })).toBeDisabled();
    fireEvent.click(within(row).getByRole('button', { name: '引用消息' }));

    const referenceLine = buildBetaMessageReferenceLine({
      profileId: PROFILE, eventId: EVENT, text: '', label: '附件记录', metadata: '附件名：receipt.pdf',
    });
    expect(editor).toHaveValue(referenceLine + '\n');
    expect(referenceLine).toContain('· 元数据：附件名：receipt.pdf');
    expect(referenceLine).not.toContain(' | ');
    expect(screen.getByRole('region', { name: '草稿中的外心档案内引用' })).toHaveTextContent('附件名：receipt.pdf');
  });

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
    fireEvent.click(within(row).getByRole('button', { name: '复制外心档案内定位链接' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: EVENT })));
    fireEvent.click(within(row).getByRole('button', { name: '引用消息' }));

    const referenceLine = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: body });
    expect(editor).toHaveValue(referenceLine + '\n先写下的内容');
    expect(screen.getByRole('region', { name: '草稿中的外心档案内引用' })).toHaveTextContent('原消息正文');
    fireEvent.click(screen.getByRole('button', { name: '档案内引用如何保存' }));
    expect(screen.getByText(/只用于外心档案内定位/)).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: referenceLine + '\n期间继续输入的内容' } });
    fireEvent.click(screen.getByRole('button', { name: /从草稿移除引用/ }));
    expect(editor).toHaveValue('期间继续输入的内容');
    expect(screen.queryByRole('region', { name: '草稿中的外心档案内引用' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /在外心档案内回看原文/ }));

    expect(await screen.findByText(/此引用属于另一个外心档案/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /在外心档案内回看原文：目标记录摘要/ }));
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
    expect(screen.queryByText('已在当前外心档案内找到引用原文')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /在外心档案内回看原文：可定位摘要/ }));

    const location = await screen.findByRole('region', { name: '外心档案内引用定位结果' });
    expect(location).toHaveTextContent('已在当前外心档案内找到引用原文');
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
    fireEvent.click(screen.getByRole('button', { name: /在外心档案内回看原文/ }));

    await waitFor(() => expect(screen.getByText('折叠视图中的原文')).toBeVisible());
    expect(history).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '回到原阅读位置' }));
    await waitFor(() => expect(screen.queryByTestId('beta-message-location-boundary')).not.toBeInTheDocument());
    if(visibleBefore)expect(history).toBeVisible();else expect(history).not.toBeVisible();
    expect(JSON.parse(localStorage.getItem('exomind:beta:workspace-layout') ?? '{}')).toMatchObject({ records, minimal });
  });
});
