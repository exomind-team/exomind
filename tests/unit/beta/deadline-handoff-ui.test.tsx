import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { rememberLastBetaProfile } from '@/beta/last-profile';
import type { BetaDeadlineHandoff, BetaDeadlineHandoffsClient } from '@/beta/deadline-handoff-client';
import { asyncDraftLocks } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { B, C, D, P, Q, R, activeSnapshot, snapshot, timeblockClient } from './timeblock-fixtures';

const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
const target: BetaDeadlineHandoff = { handoff_id: R, profile_id: P, block_id: B, deadline_id: C };
function handoffs() {
  let pending: BetaDeadlineHandoff | null = null; let changed = () => {};
  const client = { pending: vi.fn(async () => pending), acknowledge: vi.fn(async (id: string) => { if (pending?.handoff_id !== id) return false; pending = null; return true; }), subscribe: vi.fn(async (listener: () => void) => { changed = listener; return () => {}; }) } satisfies BetaDeadlineHandoffsClient;
  return { client, tap(value: BetaDeadlineHandoff) { pending = value; changed(); } };
}
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() }); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }); });
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');if (locks) Object.defineProperty(navigator, 'locks', locks); else Reflect.deleteProperty(navigator, 'locks'); });
describe('notification tap uses the real Beta profile/draft and mounted timeblock area', () => {
  it('saves Q before opening existing P, locates the real timeblock section before ACK and sends no Core mutation', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: 'P' }, { profile_id: Q, display_name: 'Q' }]);
    client.timeblocks.snapshot.mockImplementation(async profile => profile === P ? activeSnapshot() : { ...snapshot(), profile_id: Q });
    rememberLastBetaProfile(D, Q, [{ profile_id: P }, { profile_id: Q }]); const journal = memoryIntentJournal(); const taps = handoffs();
    render(<BetaApp client={client} handoffs={taps.client} intentJournal={journal}/>); const input = await screen.findByRole('textbox', { name: '记录当下' }); expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue(Q);
    fireEvent.change(input, { target: { value: 'Q draft before notification' } });
    taps.client.acknowledge.mockImplementation(async id => { expect(id).toBe(target.handoff_id); expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue(P); expect(screen.getByRole('region', { name: '时间块' })).toBeInTheDocument(); expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled(); expect(JSON.parse(journal.values.get(`exomind:beta:drafts:${D}`)!).drafts[Q].text).toBe('Q draft before notification'); return true; });
    await act(async () => { taps.tap(target); }); await waitFor(() => expect(taps.client.acknowledge).toHaveBeenCalledTimes(1));
    expect(client.capture).not.toHaveBeenCalled(); expect(client.provisionProfile).not.toHaveBeenCalled(); expect(client.timeblocks.command).not.toHaveBeenCalled(); expect(await screen.findByText(/当前仍在运行/)).toBeInTheDocument();
  });
  it('keeps a missing source profile pending without creating it and provides a visible retry', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: Q, display_name: 'Q' }]); client.timeblocks.snapshot.mockResolvedValue({ ...snapshot(), profile_id: Q }); const taps = handoffs();
    render(<BetaApp client={client} handoffs={taps.client} intentJournal={memoryIntentJournal()}/>); await screen.findByRole('textbox', { name: '记录当下' });
    await act(async () => { taps.tap(target); }); await screen.findByText(/通知对应档案不在本机/);
    expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue(Q); expect(screen.getByRole('button', { name: '重试打开提醒' })).toBeEnabled(); expect(taps.client.acknowledge).not.toHaveBeenCalled(); expect(client.provisionProfile).not.toHaveBeenCalled(); expect(client.timeblocks.command).not.toHaveBeenCalled();
  });
});
