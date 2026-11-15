import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { rememberLastBetaProfile, restoreLastBetaProfile } from '@/beta/last-profile';
import type { BetaPeersClient } from '@/beta/peers-client';
import { asyncDraftLocks, fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const profiles = [{ profile_id: 'p', display_name: 'P' }, { profile_id: 'q', display_name: 'Q' }];
function resetLocks() { Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() }); }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetLocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); if (locks) Object.defineProperty(navigator, 'locks', locks); else Reflect.deleteProperty(navigator, 'locks'); });

describe('Beta reopens the last successfully opened local profile', () => {
  it('restores Q after a successful selection and process-style restart, retaining the Q draft and P/Q separation', async () => {
    const client = fakeClient(); client.profiles.mockResolvedValue(profiles); const journal = memoryIntentJournal();
    const first = render(<BetaApp client={client} intentJournal={journal}/>); await screen.findByRole('textbox', { name: '记录当下' });
    const select = screen.getByRole('combobox', { name: '当前档案' }); fireEvent.change(select, { target: { value: 'q' } }); await waitFor(() => expect(select).toHaveValue('q'));
    fireEvent.change(await screen.findByRole('textbox', { name: '记录当下' }), { target: { value: 'Q unsent after restart' } });
    await waitFor(() => expect(JSON.parse(journal.values.get('exomind:beta:drafts:device-a')!).drafts.q.text).toBe('Q unsent after restart'));
    await act(async () => { first.unmount(); await Promise.resolve(); }); resetLocks();
    render(<BetaApp client={client} intentJournal={journal}/>);
    expect(await screen.findByRole('combobox', { name: '当前档案' })).toHaveValue('q'); expect(await screen.findByRole('textbox', { name: '记录当下' })).toHaveValue('Q unsent after restart');
    expect(client.provisionProfile).not.toHaveBeenCalled(); expect(client.capture).not.toHaveBeenCalled(); expect(client.profiles.mock.results.length).toBeGreaterThanOrEqual(2);
  });
  it('remembers a confirmed creation and ignores a saved profile absent from the next authoritative list', async () => {
    const client = fakeClient(); client.profiles.mockResolvedValue(profiles); render(<BetaApp client={client} intentJournal={memoryIntentJournal()}/>);
    await screen.findByRole('textbox', { name: '记录当下' }); fireEvent.click(screen.getByRole('button', { name: '管理档案' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新档案名称' }), { target: { value: 'Created locally' } }); await waitFor(() => expect(screen.getByRole('button', { name: '创建档案' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '创建档案' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); const id = client.provisionProfile.mock.calls[0][0];
    expect(restoreLastBetaProfile('device-a', [...profiles, { profile_id: id }])).toBe(id); expect(restoreLastBetaProfile('device-a', profiles)).toBe('p');
    expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue(id);
  });
  it('remembers an explicitly confirmed joined profile only after it appears locally and opens successfully', async () => {
    const client = fakeClient(); client.profiles.mockResolvedValueOnce(profiles).mockResolvedValue([...profiles, { profile_id: 'joined-p', display_name: 'Joined P' }]);
    const peers: BetaPeersClient = { status: async profile_id => ({ runtime_id: 'runtime-a', device_id: 'device-a', profile_id, network_enabled: false, local_addresses: [], peers: [] }), setEnabled: async () => {},
      createInvitation: async () => { throw new Error('not part of this test'); }, inspectInvitation: async () => ({ profile_id: 'joined-p', profile_name: 'Joined P', issuer_device_id: 'peer-x', fingerprint_sha256: 'a'.repeat(64), expires_at_ms: Date.now() + 60000, compatible: true }),
      joinInvitation: async () => ({ profile_id: 'joined-p', peer_device_id: 'peer-x', state: 'ready' }), sync: async () => {}, revoke: async () => {} };
    render(<BetaApp client={client} peers={peers} intentJournal={memoryIntentJournal()}/>); await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.click(screen.getByRole('button', { name: '同步' })); fireEvent.change(screen.getByLabelText('另一设备的完整邀请'), { target: { value: 'synthetic-opaque-invitation' } }); fireEvent.click(screen.getByRole('button', { name: '检查邀请' }));
    await screen.findByText('加入「Joined P」'); expect(restoreLastBetaProfile('device-a', profiles)).toBe('p'); fireEvent.click(screen.getByRole('button', { name: '确认加入档案' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue('joined-p'));
    expect(restoreLastBetaProfile('device-a', [...profiles, { profile_id: 'joined-p' }])).toBe('joined-p'); expect(client.provisionProfile).not.toHaveBeenCalled();
  });
  it('does not persist a switch whose required draft flush failed', async () => {
    rememberLastBetaProfile('device-a', 'p', profiles); const client = fakeClient(); client.profiles.mockResolvedValue(profiles); const values = new Map<string, string>();
    let fail=true;const journal = { read: async (key: string) => values.get(key) ?? null, write: async (key:string,raw:string) => { if(fail)throw new Error('synthetic quota');values.set(key,raw); } };
    render(<BetaApp client={client} intentJournal={journal}/>); const input = await screen.findByRole('textbox', { name: '记录当下' }); fireEvent.change(input, { target: { value: 'P must stay' } }); await screen.findByRole('button', { name: '重试记录草稿暂存' });
    fireEvent.change(screen.getByRole('combobox', { name: '当前档案' }), { target: { value: 'q' } }); await screen.findByText(/未切换档案/);
    expect(restoreLastBetaProfile('device-a', [{ profile_id: 'q' }, { profile_id: 'p' }])).toBe('p'); expect(screen.getByRole('combobox', { name: '当前档案' })).toHaveValue('p');fail=false;
  });
  it('continues to switch and record when only preference storage is unavailable', async () => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) { if (key.startsWith('exomind:beta:last-profile:')) throw new Error('preference read denied'); return get.call(this, key); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (key.startsWith('exomind:beta:last-profile:')) throw new Error('preference write denied'); return set.call(this, key, value); });
    const client = fakeClient(); client.profiles.mockResolvedValue(profiles); render(<BetaApp client={client} intentJournal={memoryIntentJournal()}/>); await screen.findByRole('textbox', { name: '记录当下' });
    const select = screen.getByRole('combobox', { name: '当前档案' }); fireEvent.change(select, { target: { value: 'q' } }); await waitFor(() => expect(select).toHaveValue('q'));
    fireEvent.change(await screen.findByRole('textbox', { name: '记录当下' }), { target: { value: 'record without preferences' } }); await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1)); expect(client.capture.mock.calls[0][0].profile_id).toBe('q'); expect(await screen.findByText('本机已保存')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: '重新连接' })).not.toBeInTheDocument();
  });
});
