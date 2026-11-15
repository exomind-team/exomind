import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaApiError } from '@/beta/api-error';
import { nativeBetaDeadlineHandoffsClient, type BetaDeadlineHandoff, type BetaDeadlineHandoffsClient } from '@/beta/deadline-handoff-client';
import { describeDeadlineHandoff, useBetaDeadlineHandoff } from '@/beta/deadline-handoff';
import type { BetaTimeblockNode } from '@/beta/timeblocks-types';
import { deferred } from './fixtures';
import { B, C, D, P, Q, R, timeblockClient } from './timeblock-fixtures';

const first: BetaDeadlineHandoff = { handoff_id: R, profile_id: P, block_id: B, deadline_id: C };
const second: BetaDeadlineHandoff = { ...first, handoff_id: '77777777-7777-4777-8777-777777777777', profile_id: Q };
type Open = Parameters<typeof useBetaDeadlineHandoff>[3];
function transport(initial: BetaDeadlineHandoff | null = first) {
  let pending = initial; let changed = () => {}; const unsubscribe = vi.fn();
  const client = { pending: vi.fn(async () => pending), acknowledge: vi.fn(async (id: string) => { if (pending?.handoff_id !== id) return false; pending = null; return true; }),
    subscribe: vi.fn(async (listener: () => void) => { changed = listener; return unsubscribe; }) } satisfies BetaDeadlineHandoffsClient;
  return { client, unsubscribe, tap(next: BetaDeadlineHandoff | null) { pending = next; changed(); } };
}
function Harness({ client, open, scope = 'device-a' }: { client: BetaDeadlineHandoffsClient; open: Open; scope?: string }) {
  const view = useBetaDeadlineHandoff(client, scope, true, open);
  return <><p role={view.failed ? 'alert' : 'status'}>{view.message}</p><button disabled={view.busy} onClick={view.retry}>retry</button></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('deadline notification handoff delivery and acknowledgement', () => {
  it('installs the listener before startup pending reads and acknowledges only after the opener has really completed', async () => {
    const f = transport(); const listening = deferred<() => void>(); f.client.subscribe.mockReturnValueOnce(listening.promise);
    const opened = deferred<string>(); const open = vi.fn<Open>(() => opened.promise);
    render(<Harness client={f.client} open={open}/>); await waitFor(() => expect(f.client.subscribe).toHaveBeenCalledTimes(1)); expect(f.client.pending).not.toHaveBeenCalled();
    await act(async () => { listening.resolve(f.unsubscribe); }); await waitFor(() => expect(open).toHaveBeenCalledTimes(1)); expect(f.client.acknowledge).not.toHaveBeenCalled();
    await act(async () => { opened.resolve('real location opened'); }); await screen.findByText('real location opened'); expect(f.client.acknowledge).toHaveBeenCalledWith(first.handoff_id);
  });
  it('keeps failed draft/navigation work pending for an explicit retry and does not disclose exception bodies', async () => {
    const f = transport(); const open = vi.fn<Open>().mockRejectedValueOnce(new BetaApiError('handoff_draft_pending', 'synthetic-private-path')).mockResolvedValue('opened on retry');
    render(<Harness client={f.client} open={open}/>); await screen.findByText(/当前草稿尚未完成本机暂存/); expect(f.client.acknowledge).not.toHaveBeenCalled(); expect(screen.queryByText('synthetic-private-path')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' })); await screen.findByText('opened on retry'); expect(f.client.acknowledge).toHaveBeenCalledTimes(1);
  });
  it('fences an old opener immediately on a newer tap and never acknowledges its obsolete ID', async () => {
    const f = transport(); const old = deferred<string>(), next = deferred<string>(); const open = vi.fn<Open>().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    render(<Harness client={f.client} open={open}/>); await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await act(async () => { f.tap(second); }); expect(open.mock.calls[0][1]()).toBe(false); expect(open.mock.calls[0][2].aborted).toBe(true);
    await act(async () => { old.resolve('obsolete location'); }); await waitFor(() => expect(open).toHaveBeenCalledTimes(2)); expect(open.mock.calls[1][0]).toEqual(second); expect(f.client.acknowledge).not.toHaveBeenCalled();
    await act(async () => { next.resolve('latest location'); }); await screen.findByText('latest location'); expect(f.client.acknowledge.mock.calls).toEqual([[second.handoff_id]]);
  });
  it('drops a late response after client/device replacement and unregisters the old listener', async () => {
    const old = transport(), next = transport(second); const gate = deferred<string>(); const open = vi.fn<Open>(handoff => handoff.handoff_id === first.handoff_id ? gate.promise : Promise.resolve('new device location'));
    const ui = render(<Harness client={old.client} open={open}/>); await waitFor(() => expect(open).toHaveBeenCalledTimes(1)); ui.rerender(<Harness client={next.client} scope="device-b" open={open}/>);
    await screen.findByText('new device location'); expect(old.unsubscribe).toHaveBeenCalledTimes(1); await act(async () => { gate.resolve('old device location'); });
    expect(old.client.acknowledge).not.toHaveBeenCalled(); expect(next.client.acknowledge).toHaveBeenCalledWith(second.handoff_id); expect(screen.queryByText('old device location')).not.toBeInTheDocument();
  });
  it('retains a navigation whose durable ACK is unconfirmed without repeatedly acknowledging in the background',async()=>{
    const f=transport();f.client.acknowledge.mockRejectedValueOnce(new BetaApiError('deadline_handoff_unconfirmed','synthetic-private-path'));
    const open=vi.fn<Open>(async()=> 'location opened');render(<Harness client={f.client} open={open}/>);
    await screen.findByText(/系统尚未确认入口已处理/);expect(f.client.acknowledge).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'retry'}));await screen.findByText('location opened');expect(f.client.acknowledge).toHaveBeenCalledTimes(2);
  });
  it('validates Native identities and exact ACK responses without parsing an Android URI', async () => {
    let response: unknown = first; const call = vi.fn(async () => response); const client = nativeBetaDeadlineHandoffsClient(call, async () => () => {});
    expect(await client.pending()).toEqual(first); expect(call).toHaveBeenLastCalledWith('beta_deadline_handoff_pending', {});
    response = true; expect(await client.acknowledge(first.handoff_id)).toBe(true); expect(call).toHaveBeenLastCalledWith('beta_deadline_handoff_ack', { handoffId: first.handoff_id });
    for (const value of [{ ...first, profile_id: 'unknown' }, { ...first, handoff_id: '00000000-0000-0000-0000-000000000000' }, { ...first, uri: 'synthetic-private-uri' }]) { response = value; await expect(client.pending()).rejects.toMatchObject({ code: 'invalid_deadline_handoff' }); }
    response = { success: true }; await expect(client.acknowledge(first.handoff_id)).rejects.toMatchObject({ code: 'invalid_deadline_handoff' });
  });
  it('describes completed source blocks from real facts and leaves an unknown block explicitly unresolved', async () => {
    const base = timeblockClient(); const node: BetaTimeblockNode = { event_id: R, profile_id: P, device_id: D, source: { kind: 'human', author_id: D, owner_generation: null }, parents: [], occurred_at_ms: 1, effective_at_ms: 1,
      clock: { epoch_id: R, elapsed_ms: 1 }, payload: { kind: 'action', action: { kind: 'submit_feedback', block_id: B, feedback: { kind: 'skipped' } } }, digest: 'a'.repeat(64), local_seq: 1 };
    const nodes = vi.fn(async () => ({ items: [node], highwater: 1, next_before: null })); const client = { ...base.timeblocks, nodes };
    expect(await describeDeadlineHandoff(client, first, () => true)).toContain('已完成'); expect(base.timeblocks.command).not.toHaveBeenCalled();
    nodes.mockResolvedValueOnce({ items: [], highwater: 0, next_before: null }); await expect(describeDeadlineHandoff(client, first, () => true)).rejects.toMatchObject({ code: 'handoff_missing_block' });
  });
});
