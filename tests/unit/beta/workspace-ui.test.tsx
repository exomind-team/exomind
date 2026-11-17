import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { asyncDraftLocks } from './fixtures';
import { D, P, activeSnapshot, timeblockClient } from './timeblock-fixtures';
import { BetaFocusTimer } from '@/beta/BetaFocusTimer';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});
afterEach(() => {
  if (locks) Object.defineProperty(navigator, 'locks', locks);
  else Reflect.deleteProperty(navigator, 'locks');
});

describe('Beta daily workspace continuity', () => {
  it('hides and collapses panes without replacing the input or reading context, and always offers recovery', async () => {
    const client = timeblockClient();
    client.profiles.mockResolvedValue([{ profile_id: P, display_name: '我的档案' }]);
    const view = render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    const history = screen.getByLabelText('记录历史');
    await waitFor(() => expect(history).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(input, { target: { value: '还在写的半句话' } });
    Object.defineProperties(history, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    history.scrollTop = 280; fireEvent.scroll(history);
    fireEvent.click(screen.getByRole('button', { name: '折叠记录' }));
    expect(history).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '折叠记录' }));
    expect(history).toBeVisible(); expect(history.scrollTop).toBe(280);
    fireEvent.click(screen.getByRole('button', { name: '隐藏记录' }));
    fireEvent.click(screen.getByRole('button', { name: '隐藏专注' }));
    expect(history).not.toBeVisible();
    expect(screen.getByRole('textbox', { name: '记录当下' })).toBe(input);
    expect(input).toHaveValue('还在写的半句话');
    fireEvent.click(screen.getByRole('button', { name: '恢复默认视图' }));
    expect(history).toBeVisible(); expect(history.scrollTop).toBe(280);
    expect(client.capture).not.toHaveBeenCalled(); expect(client.timeblocks.command).not.toHaveBeenCalled();
    const closing = vi.mocked(navigator.locks.request).mock.results.at(-1)?.value;
    view.unmount();
    await act(async () => { await closing; });
    const next = render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    await screen.findByRole('textbox', { name: '记录当下' });
    expect(screen.getByLabelText('记录历史')).toBeVisible();
    next.unmount();
  });

  it('keeps feedback on Ctrl/Cmd+Enter even when message sending uses Enter', async () => {
    localStorage.setItem('exomind:beta:input-send-mode', 'enter-send');
    const client = timeblockClient();
    client.profiles.mockResolvedValue([{ profile_id: P, display_name: '我的档案' }]);
    client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    fireEvent.click(await screen.findByRole('button', { name: '追加反馈' }));
    const input = screen.getByTestId('new-focus-feedback-textarea');
    fireEvent.change(input, { target: { value: '保留输入上下文' } });
    await waitFor(() => expect(screen.getByTestId('new-focus-feedback-confirm')).toBeEnabled());
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(client.timeblocks.command).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(client.timeblocks.command).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(client.timeblocks.command).toHaveBeenCalledTimes(1));
    expect(client.timeblocks.command.mock.calls[0][0].action.kind).toBe('append_feedback');
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('keeps a failed submission visible and retains its content when records are hidden', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: '我的档案' }]);
    client.capture.mockRejectedValue(new Error('合成存储失败，原提交保留'));
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.click(screen.getByRole('button', { name: '隐藏记录' }));
    fireEvent.change(input, { target: { value: '不能被隐藏的失败记录' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(screen.getAllByText('合成存储失败，原提交保留').some(element => element.closest('[role="alert"]') !== null)).toBe(true));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '记录当下' })).toHaveValue('不能被隐藏的失败记录');
  });

  it('applies a recoverable session layout even if saving the device preference fails', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: '我的档案' }]);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    await screen.findByRole('textbox', { name: '记录当下' });
    const original = localStorage.setItem.bind(localStorage);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(function(key, value) {
      if (key === 'exomind:beta:workspace-layout') throw new Error('synthetic preference write failure');
      return original(key, value);
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: '隐藏记录' }));
      expect(screen.getByLabelText('记录历史')).not.toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent('布局已应用，但本机偏好未能保存');
      fireEvent.click(screen.getByRole('button', { name: '恢复默认视图' }));
      expect(screen.getByLabelText('记录历史')).toBeVisible();
      expect(client.capture).not.toHaveBeenCalled();
    } finally { write.mockRestore(); }
  });

  it('defers a hidden history refresh and reconciles it once when the same pane returns', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: '我的档案' }]);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    const before = client.eventsPage.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '隐藏记录' }));
    fireEvent.change(input, { target: { value: '隐藏时仍然记录' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('本机已保存');
    expect(client.eventsPage).toHaveBeenCalledTimes(before);
    fireEvent.click(screen.getByRole('button', { name: '隐藏记录' }));
    await waitFor(() => expect(client.eventsPage).toHaveBeenCalledTimes(before + 1));
    expect(screen.getByRole('textbox', { name: '记录当下' })).toBe(input);
  });

  it('stops hidden timer UI reads and resumes one authoritative read without issuing a timer command', async () => {
    const client = timeblockClient();
    const owner = await BetaTimeblockController.open(client, D, P, { journal: memoryIntentJournal() });
    const view = render(<BetaFocusTimer controller={owner} client={client} profileId={P} visible={false} />);
    vi.useFakeTimers();
    try {
      const baseline = client.timeblocks.snapshot.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(baseline);
      view.rerender(<BetaFocusTimer controller={owner} client={client} profileId={P} visible />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(baseline + 1);
      view.rerender(<BetaFocusTimer controller={owner} client={client} profileId={P} visible={false} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(baseline + 1);
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); view.unmount(); await owner.close(); }
  });
});
