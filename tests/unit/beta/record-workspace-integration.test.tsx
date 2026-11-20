import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { BetaApiError, type BetaClient, type BetaEvent, type BetaQuery, type BetaReceipt } from '@/beta/client';
import type { BetaCorrectionPage, BetaRecordCorrectionCommand, BetaRecordOrganizationClient } from '@/beta/record-organization-client';
import type { BetaTimelinePage } from '@/beta/timeblocks-types';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';
import { selectField } from './select-field';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const EVENT = '22222222-2222-4222-8222-222222222222';
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

function eventRecord(text = 'original wording', localSeq = 1): BetaEvent {
  return {
    event_id: EVENT, profile_id: 'p', device_id: 'device-a', author_id: 'device-a', author_kind: 'human',
    occurred_at_ms: 1234, text, tags: ['daily'], digest: 'a'.repeat(64), local_seq: localSeq,
  };
}

function correctionPage(
  items: BetaCorrectionPage['items'] = [],
  highwater = 1,
  nextBefore: number | null = null,
): BetaCorrectionPage {
  return { items, next_before: nextBefore, highwater };
}

function committed(command: { command_id: string; event_id: string; profile_id: string }): BetaReceipt {
  return { ...command, local_seq: 2, event_digest: 'b'.repeat(64), durability: 'local_committed', replayed: false };
}

function timeline(record: BetaEvent, highwater = record.local_seq): BetaTimelinePage {
  return { items: [{ kind: 'capture', record }], next_before: null, highwater };
}

function recordClient(overrides: Partial<BetaRecordOrganizationClient> = {}) {
  return {
    eventsPageWithTag: vi.fn(async (_profileId: string, _query: BetaQuery, _tag: string) => ({ items: [eventRecord()], next_before: null, highwater: 1 })),
    correctionsForTarget: vi.fn(async () => correctionPage()),
    recordCorrection: vi.fn(async (command: BetaRecordCorrectionCommand) => committed(command)),
    ...overrides,
  } satisfies BetaRecordOrganizationClient;
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});

afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  localStorage.clear(); sessionStorage.clear();
});

describe('Beta record workspace organization', () => {
  it('persists capture tags in the fixed submit command and combines exact tag with text search', async () => {
    const organization = recordClient();
    const client = { ...fakeClient(), recordOrganization: organization } as BetaClient;
    client.eventsPage = vi.fn(async () => ({ items: [eventRecord()], next_before: null, highwater: 1 }));
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    const editor = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByRole('button', { name: /编辑记录标签/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '添加记录标签' }), { target: { value: 'daily' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(editor, { target: { value: 'record body' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    expect(client.capture.mock.calls[0][0].tags).toEqual(['daily']);

    fireEvent.change(editor, { target: { value: 'keep draft during filtering' } });
    fireEvent.click(screen.getByRole('button', { name: '检索记录' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索记录' }), { target: { value: 'needle' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    fireEvent.change(screen.getByRole('textbox', { name: '按标签筛选记录' }), { target: { value: 'daily' } });
    fireEvent.click(screen.getByRole('button', { name: '按标签筛选' }));

    await waitFor(() => expect(organization.eventsPageWithTag).toHaveBeenCalled());
    expect(organization.eventsPageWithTag.mock.calls.at(-1)).toEqual(['p', { limit: 100, search: 'needle' }, 'daily']);
    expect(screen.getByText(/仅显示记录，不含时间块和回顾/)).toBeInTheDocument();
    expect(editor).toHaveValue('keep draft during filtering');
    fireEvent.click(screen.getByRole('button', { name: '清除标签' }));
    await waitFor(() => expect(client.eventsPage).toHaveBeenCalledWith('p', { limit: 100, search: 'needle' }));
    expect(editor).toHaveValue('keep draft during filtering');
  });

  it('searches a corrected wording back to its capture and leaves the original visible until the correction is opened', async () => {
    const record = eventRecord('source wording');
    const corrected = {
      target_state: 'digest_matches' as const,
      record: {
        event_id: '44444444-4444-4444-8444-444444444444', profile_id: 'p', device_id: 'device-a', author_id: 'human-a',
        author_kind: 'human' as const, occurred_at_ms: 2, target_event_id: EVENT, target_digest: record.digest,
        corrected_text: 'corrected wording', digest: 'b'.repeat(64), local_seq: 2,
      },
    };
    const organization = recordClient({
      correctionsForTarget: vi.fn(async () => correctionPage([corrected], 2)),
    });
    const client = { ...fakeClient(), recordOrganization: organization,
      timelinePage: vi.fn(async (_profileId: string, _query: BetaQuery): Promise<BetaTimelinePage> => timeline(record, 2)) } as BetaClient;
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByRole('button', { name: '检索记录' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索记录' }), { target: { value: 'corrected wording' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await waitFor(() => expect(client.timelinePage).toHaveBeenCalledWith('p', { limit: 100, search: 'corrected wording' }));
    const row = screen.getByTestId('new-mobile-user-message-row');
    expect(within(row).getByText('source wording')).toBeInTheDocument();
    expect(within(row).queryByText('corrected wording')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(within(row).getByRole('button', { name: '查看更正与原文' }));

    expect(await screen.findByText('corrected wording')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '原始记录' })).toHaveTextContent('source wording');
    expect(screen.getByRole('region', { name: '已有更正' })).toHaveTextContent('最新更正');
  });

  it('keeps the newest matching correction current while older pages are merged', async () => {
    const record = eventRecord('source wording', 5);
    const latest = {
      target_state: 'digest_matches' as const,
      record: {
        event_id: '44444444-4444-4444-8444-444444444444', profile_id: 'p', device_id: 'device-a', author_id: 'human-a',
        author_kind: 'human' as const, occurred_at_ms: 4, target_event_id: EVENT, target_digest: record.digest,
        corrected_text: 'latest correction wording', digest: 'b'.repeat(64), local_seq: 4,
      },
    };
    const older = {
      target_state: 'digest_matches' as const,
      record: {
        event_id: '55555555-5555-4555-8555-555555555555', profile_id: 'p', device_id: 'device-a', author_id: 'human-a',
        author_kind: 'human' as const, occurred_at_ms: 3, target_event_id: EVENT, target_digest: record.digest,
        corrected_text: 'older correction wording', digest: 'c'.repeat(64), local_seq: 3,
      },
    };
    let requestCount = 0;
    const organization = recordClient({
      correctionsForTarget: vi.fn(async () => {
        requestCount += 1;
        return requestCount === 1 ? correctionPage([latest], 5, 4) : correctionPage([older], 5);
      }),
    });
    const client = { ...fakeClient(), recordOrganization: organization,
      timelinePage: vi.fn(async (_profileId: string, _query: BetaQuery) => timeline(record, 5)) } as BetaClient;
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);

    await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const row = screen.getByTestId('new-mobile-user-message-row');
    fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(within(row).getByRole('button', { name: '查看更正与原文' }));
    await screen.findByText('latest correction wording');
    const currentCorrection = screen.getByTestId('beta-current-correction');

    fireEvent.click(screen.getByRole('button', { name: '加载更早更正' }));
    await screen.findByText('older correction wording');

    expect(within(currentCorrection).getByText('latest correction wording')).toBeInTheDocument();
    expect(screen.getAllByText('older correction wording')).toHaveLength(1);
    expect(organization.correctionsForTarget).toHaveBeenCalledTimes(2);
  });

  it('does not write when correction is cancelled and retries an unknown result with the same command identity', async () => {
    const record = eventRecord();
    const recordCorrection = vi.fn(async (command: BetaRecordCorrectionCommand) => committed(command))
      .mockRejectedValueOnce(new Error('connection lost'));
    const organization = recordClient({ recordCorrection });
    const client = { ...fakeClient(), recordOrganization: organization,
      timelinePage: vi.fn(async (_profileId: string, _query: BetaQuery) => timeline(record)) } as BetaClient;
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const row = screen.getByTestId('new-mobile-user-message-row');
    const openCorrection = () => {
      fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
      fireEvent.click(within(row).getByRole('button', { name: '查看更正与原文' }));
    };

    openCorrection();
    await screen.findByText('还没有更正记录。');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    expect(organization.recordCorrection).not.toHaveBeenCalled();

    openCorrection();
    await screen.findByText('还没有更正记录。');
    fireEvent.change(screen.getByRole('textbox', { name: '写下更正内容' }), { target: { value: 'fixed wording' } });
    fireEvent.click(screen.getByRole('button', { name: '保存更正' }));
    await screen.findByText(/提交结果尚未确认/);
    const firstCommand = organization.recordCorrection.mock.calls[0][0];
    expect(firstCommand.target_event_id).toBe(EVENT);
    expect(firstCommand.target_digest).toBe(record.digest);

    fireEvent.click(screen.getByRole('button', { name: '查证并重试' }));
    await waitFor(() => expect(organization.recordCorrection).toHaveBeenCalledTimes(2));
    expect(organization.recordCorrection.mock.calls[1][0]).toEqual(firstCommand);
  });

  it('keeps a late correction result scoped to P while Q remains active', async () => {
    const record = eventRecord();
    const flight = deferred<BetaReceipt>();
    let pendingCommand: BetaRecordCorrectionCommand | null = null;
    let correctionAccepted = false;
    const correction = {
      target_state: 'digest_matches' as const,
      record: {
        event_id: '44444444-4444-4444-8444-444444444444', profile_id: 'p', device_id: 'device-a', author_id: 'human-a',
        author_kind: 'human' as const, occurred_at_ms: 3, target_event_id: EVENT, target_digest: record.digest,
        corrected_text: 'P correction', digest: 'b'.repeat(64), local_seq: 2,
      },
    };
    const organization = recordClient({
      correctionsForTarget: vi.fn(async () => correctionAccepted ? correctionPage([correction], 2) : correctionPage()),
      recordCorrection: vi.fn((command: BetaRecordCorrectionCommand) => { pendingCommand = command; return flight.promise; }),
    });
    const client = { ...fakeClient(), recordOrganization: organization,
      timelinePage: vi.fn(async (profileId: string, _query: BetaQuery): Promise<BetaTimelinePage> => profileId === 'p'
        ? timeline(record, 2)
        : { items: [], next_before: null, highwater: 0 }) } as BetaClient;
    client.receipt = vi.fn(async () => null) as BetaClient['receipt'];
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const openCorrection = async () => {
      const row = await screen.findByTestId('new-mobile-user-message-row');
      fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
      fireEvent.click(within(row).getByRole('button', { name: '查看更正与原文' }));
    };
    await openCorrection();
    await screen.findByText('还没有更正记录。');
    fireEvent.change(screen.getByRole('textbox', { name: '写下更正内容' }), { target: { value: 'P correction' } });
    fireEvent.click(screen.getByRole('button', { name: '保存更正' }));
    await waitFor(() => expect(organization.recordCorrection).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name:'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const profileSelect = screen.getByRole('combobox', { name: '当前档案' });
    await selectField(profileSelect, 'q');
    await waitFor(() => expect(profileSelect).toHaveValue('q'));
    const qEditor = await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.change(qEditor, { target: { value: 'Q draft stays here' } });
    correctionAccepted = true;
    await act(async () => { flight.resolve(committed(pendingCommand!)); await flight.promise; });
    expect(qEditor).toHaveValue('Q draft stays here');

    await selectField(profileSelect, 'p');
    await waitFor(() => expect(profileSelect).toHaveValue('p'));
    await openCorrection();
    expect(await screen.findByText('P correction')).toBeInTheDocument();
    expect(client.receipt).toHaveBeenCalledWith('p', pendingCommand?.command_id);
    expect(client.receipt).toHaveBeenCalledTimes(1);
    expect(organization.recordCorrection).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name:'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await selectField(profileSelect, 'q');
    await waitFor(() => expect(profileSelect).toHaveValue('q'));
    expect(await screen.findByRole('textbox', { name: '记录当下' })).toHaveValue('Q draft stays here');
  });

  it('shows a digest conflict as a rejected correction and never as success', async () => {
    const record = eventRecord();
    const organization = recordClient({
      recordCorrection: vi.fn(async () => { throw new BetaApiError('correction_target_conflict', 'conflict', 409); }),
    });
    const client = { ...fakeClient(), recordOrganization: organization,
      timelinePage: vi.fn(async (_profileId: string, _query: BetaQuery) => timeline(record)) } as BetaClient;
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const row = screen.getByTestId('new-mobile-user-message-row');
    fireEvent.click(within(row).getByRole('button', { name: '更多消息操作' }));
    fireEvent.click(within(row).getByRole('button', { name: '查看更正与原文' }));
    await screen.findByText('还没有更正记录。');
    fireEvent.change(screen.getByRole('textbox', { name: '写下更正内容' }), { target: { value: 'must not be accepted' } });
    fireEvent.click(screen.getByRole('button', { name: '保存更正' }));

    expect(await screen.findByText(/原始记录不存在或摘要不匹配/)).toBeInTheDocument();
    expect(screen.queryByText('更正已记录，原始记录仍保留。')).not.toBeInTheDocument();
    expect(organization.recordCorrection).toHaveBeenCalledTimes(1);
  });
});
