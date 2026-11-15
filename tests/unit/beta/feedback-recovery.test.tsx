import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaFocusTimer } from '@/beta/BetaFocusTimer';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import type { BetaTimeblockSnapshot } from '@/beta/timeblocks-types';
import { deferred } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { B, C, D, P, R, activeSnapshot, snapshot, timeblockClient } from './timeblock-fixtures';

function pending(): BetaTimeblockSnapshot {
  return { ...activeSnapshot(), active: { ...activeSnapshot().active!, phase: 'feedback_pending', deadline: null, deadline_reached: true, work_ms: 1000 }, pending_feedback: [B] };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Beta feedback recovery and notification source readiness', () => {
  it('offers an explicit submit/skip entry for the active pending block after restart, with its retained draft', async () => {
    const client = timeblockClient(); client.timeblocks.snapshot.mockResolvedValue(pending()); const journal = memoryIntentJournal();
    const before = await BetaTimeblockController.open(client, D, P, { journal }); before.setFeedbackDraft(B, 'retained feedback after restart'); await before.flush(); await before.close();
    const owner = await BetaTimeblockController.open(client, D, P, { journal }); const ui = render(<BetaFocusTimer controller={owner} client={client} profileId={P}/>);
    try {
      const entry = await screen.findByRole('button', { name: `填写反馈 ${B.slice(0, 8)}` }); await waitFor(() => expect(entry).toBeEnabled());
      expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument(); expect(client.timeblocks.command).not.toHaveBeenCalled();
      fireEvent.click(entry); expect(await screen.findByTestId('new-focus-feedback-textarea')).toHaveValue('retained feedback after restart'); expect(screen.getByRole('button', { name: '明确跳过反馈' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Close' })); await waitFor(() => expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument());
      await act(async () => { await owner.refresh(); }); expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument(); expect(client.timeblocks.command).not.toHaveBeenCalled();
    } finally { ui.unmount(); await owner.close(); }
  });
  it('does not signal notification readiness at section mount, and waits for hydrated source identity plus the actual Alpha form portal', async () => {
    const client = timeblockClient(), gate = deferred<BetaTimeblockSnapshot>(); client.timeblocks.snapshot.mockResolvedValue(pending()).mockReturnValueOnce(gate.promise);
    const owner = await BetaTimeblockController.open(client, D, P, { journal: memoryIntentJournal() });
    const ready = vi.fn(() => { const marker = document.querySelector(`[data-beta-feedback-block-id="${B}"][data-beta-feedback-kind="submit"]`); expect(marker?.closest('[role="dialog"]')).toHaveAttribute('data-state', 'open'); expect(screen.getByTestId('new-focus-feedback-textarea')).toBeInTheDocument(); });
    const props = { controller: owner, client, profileId: P, onHandoffReady: ready };
    const ui = render(<BetaFocusTimer {...props} handoffTarget={{ handoffId: R, blockId: B, attempt: 1 }}/>);
    try {
      expect(screen.getByRole('region', { name: '时间块' })).toBeInTheDocument(); await waitFor(() => expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(1)); expect(ready).not.toHaveBeenCalled();
      await act(async () => { gate.resolve(pending()); }); await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
      expect(ready).toHaveBeenLastCalledWith(R, expect.stringContaining('等待反馈'), 1); expect(document.querySelector('[data-testid="new-focus-end-button"]')).toHaveAttribute('aria-label', '反馈中（Feedback in progress）'); expect(client.timeblocks.command).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Close' })); await waitFor(() => expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument());
      await act(async () => { await owner.refresh(); await owner.refresh(); }); expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument(); expect(ready).toHaveBeenCalledTimes(1);
      ui.rerender(<BetaFocusTimer {...props} handoffTarget={{ handoffId: R, blockId: B, attempt: 2 }}/>); await screen.findByTestId('new-focus-feedback-textarea'); await waitFor(() => expect(ready).toHaveBeenCalledTimes(2)); expect(client.timeblocks.command).not.toHaveBeenCalled();
    } finally { gate.resolve(pending()); ui.unmount(); await owner.close(); }
  });
  it('opens an older pending source while another block is active and submits only after an explicit user action to that source ID', async () => {
    const client = timeblockClient(); client.timeblocks.snapshot.mockResolvedValue({ ...activeSnapshot(), active: { ...activeSnapshot().active!, block_id: C, name: 'another active block', deadline: null }, pending_feedback: [B] });
    const owner = await BetaTimeblockController.open(client, D, P, { journal: memoryIntentJournal() }); const ready = vi.fn();
    const ui = render(<BetaFocusTimer controller={owner} client={client} profileId={P} handoffTarget={{ handoffId: R, blockId: B, attempt: 1 }} onHandoffReady={ready}/>);
    try {
      await screen.findByTestId('new-focus-feedback-textarea'); await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
      expect(document.querySelector('[data-testid="new-focus-running-name-display"]')).toHaveTextContent('another active block'); expect(document.querySelector('[data-beta-feedback-block-id]')).toHaveAttribute('data-beta-feedback-block-id', B); expect(client.timeblocks.command).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '明确跳过反馈' })); await waitFor(() => expect(client.timeblocks.command).toHaveBeenCalledTimes(1)); expect(client.timeblocks.command.mock.calls[0][0].action).toEqual({ kind: 'submit_feedback', block_id: B, feedback: { kind: 'skipped' } });
    } finally { ui.unmount(); await owner.close(); }
  });
  it('does not fabricate a submit dialog or Core action for a completed source', async () => {
    const client = timeblockClient(); client.timeblocks.snapshot.mockResolvedValue(snapshot()); const owner = await BetaTimeblockController.open(client, D, P, { journal: memoryIntentJournal() }); const ready = vi.fn();
    const ui = render(<BetaFocusTimer controller={owner} client={client} profileId={P} handoffTarget={{ handoffId: R, blockId: B, attempt: 1 }} onHandoffReady={ready}/>);
    try { await waitFor(() => expect(ready).toHaveBeenCalledTimes(1)); expect(screen.queryByTestId('new-focus-feedback-textarea')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /填写反馈/ })).not.toBeInTheDocument(); expect(client.timeblocks.command).not.toHaveBeenCalled(); }
    finally { ui.unmount(); await owner.close(); }
  });
});
