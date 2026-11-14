import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import type { BetaPage, BetaReceipt } from '@/beta/client';
import { asyncDraftLocks, deferred, fakeClient, saved } from './fixtures';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});
afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
describe('Beta React entry', () => {
  it('allows one StrictMode window to edit when lock grant and release settle asynchronously', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let held = false; let grants = 0; let releases = 0;
    const request = vi.fn((_name: string, options: { ifAvailable: boolean }, callback: (lock: Lock | null) => Promise<void>) => {
      expect(options.ifAvailable).toBe(true);
      return new Promise<void>((resolve, reject) => {
        // The manager reserves ownership before delivering the asynchronous callback.
        // A competing ifAvailable request must observe this reserved lock.
        queueMicrotask(() => {
          const granted = !held;
          if (granted) { held = true; grants++; }
          setTimeout(() => {
            Promise.resolve(callback(granted ? { name: 'strict-lock', mode: 'exclusive' } as Lock : null))
              .then(() => {
                // Actual release/request completion is a later turn, not callback return.
                setTimeout(() => { if (granted) { held = false; releases++; } resolve(); }, 0);
              }, reject);
          }, 0);
        });
      });
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    const client = fakeClient(); let unmount: (() => void) | undefined;
    try {
      ({ unmount } = render(<StrictMode><BetaApp intentJournal={memoryIntentJournal()} client={client} /></StrictMode>));
      expect(await screen.findByRole('textbox', { name: '记录当下' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(held).toBe(true); expect(client.capture).not.toHaveBeenCalled();
      unmount(); unmount = undefined;
      await waitFor(() => expect(releases).toBe(grants));
      expect(held).toBe(false);
    } finally {
      unmount?.();
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  });
  it('refuses an occupied draft lock, requires explicit retry after release, and releases its own lock on cleanup', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let occupied = true; let releases = 0;
    const request = vi.fn(async (_name: string, options: { ifAvailable: boolean }, callback: (lock: Lock | null) => Promise<void>) => {
      expect(options.ifAvailable).toBe(true);
      if (occupied) return callback(null);
      occupied = true;
      try { await callback({ name: 'test-draft-lock', mode: 'exclusive' } as Lock); }
      finally { occupied = false; releases++; }
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    const client = fakeClient(); let unmount: (() => void) | undefined;
    try {
      ({ unmount } = render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />));
      expect(await screen.findByRole('alert')).toHaveTextContent('另一窗口');
      expect(screen.queryByRole('textbox', { name: '记录当下' })).not.toBeInTheDocument();
      expect(client.eventsPage).not.toHaveBeenCalled();
      occupied = false;
      // Releasing another window's lock must not silently acquire or submit.
      await act(async () => { await Promise.resolve(); });
      expect(request).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('textbox', { name: '记录当下' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '重试草稿锁' }));
      expect(await screen.findByRole('textbox', { name: '记录当下' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1][0]).toBe('exomind-beta-drafts:device-a');
      expect(client.capture).not.toHaveBeenCalled();
      expect(client.provisionProfile).not.toHaveBeenCalled();
      unmount(); unmount = undefined;
      await waitFor(() => expect(releases).toBe(1));
      expect(occupied).toBe(false);
    } finally {
      unmount?.();
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  });
  it('shows only confirmed events and a late save cannot clear newer or switched-profile drafts', async () => {
    const client = fakeClient(); const flight = deferred<BetaReceipt>(); client.capture.mockReturnValueOnce(flight.promise);
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(input, { target: { value: 'old text' } }); fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'new text' } });
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: '当前档案' }), { target: { value: 'q' } });
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue('q'));
    fireEvent.change(await screen.findByRole('textbox', { name: '记录当下' }), { target: { value: 'other profile' } });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    await act(async () => { flight.resolve(saved(client.capture.mock.calls[0][0])); await flight.promise; });
    expect(screen.getByRole('textbox', { name: '记录当下' })).toHaveValue('other profile');
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: '当前档案' }), { target: { value: 'p' } });
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue('p'));
    expect(await screen.findByRole('textbox', { name: '记录当下' })).toHaveValue('new text');
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
  });
  it('discards a stale history response after selecting another profile', async () => {
    const client = fakeClient(); const oldPage = deferred<BetaPage>();
    client.eventsPage.mockImplementationOnce(() => oldPage.promise as ReturnType<typeof client.eventsPage>);
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    const select = await screen.findByRole('combobox', { name: '当前档案' });
    await waitFor(() => expect(client.eventsPage).toHaveBeenCalledTimes(1));
    fireEvent.change(select, { target: { value: 'q' } });
    await waitFor(()=>expect(select).toHaveValue('q'));
    await act(async () => { oldPage.resolve({ items: [{ event_id:'old',profile_id:'p',device_id:'d',author_id:'a',author_kind:'human',occurred_at_ms:1234,text:'stale record',tags:[],digest:'a'.repeat(64),local_seq:1 }], next_before:null,highwater:1 }); });
    expect(screen.queryByText('stale record')).not.toBeInTheDocument();
    expect(await screen.findByText('还没有记录')).toBeInTheDocument();
  });
  it('uses the original history highwater for older pages and literal search text', async () => {
    const client = fakeClient();
    const event = (seq: number, text: string) => ({ event_id:`e${seq}`,profile_id:'p',device_id:'d',author_id:'a',author_kind:'human' as const,occurred_at_ms:1234,text,tags:[],digest:'a'.repeat(64),local_seq:seq });
    client.eventsPage.mockResolvedValueOnce({ items: [event(2, 'recent')], next_before: 2, highwater: 2 });
    client.eventsPage.mockResolvedValueOnce({ items: [event(1, 'older')], next_before: null, highwater: 2 });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: '加载更早记录' }));
    expect(await screen.findByText('older')).toBeInTheDocument();
    expect(client.eventsPage).toHaveBeenNthCalledWith(2, 'p', { before: 2, through: 2, limit: 100 });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索记录' }), { target: { value: "中文%_'" } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(client.eventsPage).toHaveBeenLastCalledWith('p', { limit: 100, search: "中文%_'" }));
    expect(await screen.findByText('没有匹配记录')).toBeInTheDocument();
  });
  it('shows read failures instead of falsely claiming an empty history', async () => {
    const client = fakeClient(); client.eventsPage.mockRejectedValueOnce({ code: 'storage', message: '记录读取失败' });
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('记录读取失败');
    expect(screen.queryByText('还没有记录')).not.toBeInTheDocument();
  });
  it('does not label a new unsent draft as saved after an earlier committed command', async () => {
    const client = fakeClient(); render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(input, { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('本机已保存')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(input, { target: { value: 'new unsent' } });
    expect(screen.queryByText('本机已保存')).not.toBeInTheDocument();
  });
});
