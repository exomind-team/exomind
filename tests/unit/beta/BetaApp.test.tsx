import { selectField } from './select-field';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { setBetaDesktopAdaptiveEnabled } from '@/beta/preferences';
import type { BetaPage, BetaReceipt } from '@/beta/client';
import type { BetaShareHandoff, BetaShareHandoffSummary, BetaShareHandoffsClient } from '@/beta/share-handoff-client';
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
  it('adds a system-shared link to the local draft and waits for the existing Send action to create the Capture',async()=>{
    const client=fakeClient();let consumed=false;
    const summary:BetaShareHandoffSummary={handoff_id:'share-link-1',received_at_ms:1234,state:'ready',bound_profile_id:null,profile_match:true,error_code:null,recovery_instruction:null,text_state:'ready',text_preview:'https://example.test/article',items:[]};
    const payload:BetaShareHandoff={...summary,text:'https://example.test/article',items:[]};
    const shared:BetaShareHandoffsClient={
      list:vi.fn(async()=>consumed?[]:[summary]),get:vi.fn(async()=>payload),
      bindProfile:vi.fn(async()=>{}),
      acknowledgeText:vi.fn(async()=>{consumed=true;}),acknowledgeItem:vi.fn(async()=>{}),
      discard:vi.fn(async()=>{}),cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async()=>vi.fn()),
    };
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} shareHandoffs={shared}/>);
    const input=await screen.findByRole('textbox',{name:'记录当下'});
    await waitFor(()=>expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy','false'));
    expect(await screen.findByRole('heading',{name:'系统分享已接收'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'添加到「我的档案」草稿'}));
    await waitFor(()=>expect(input).toHaveValue('https://example.test/article'));
    await waitFor(()=>expect(screen.queryByRole('heading',{name:'系统分享已接收'})).not.toBeInTheDocument());
    expect(shared.acknowledgeText).toHaveBeenCalledWith('share-link-1','p');
    expect(client.capture).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button',{name:'发送'}));
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
    expect(client.capture.mock.calls[0][0].text).toBe('https://example.test/article');
  });

  it('keeps an incoming system share visible until a local profile is selected or created',async()=>{
    const client=fakeClient();client.profiles.mockResolvedValue([]);
    const summary:BetaShareHandoffSummary={handoff_id:'share-before-profile',received_at_ms:1234,state:'ready',bound_profile_id:null,profile_match:true,error_code:null,recovery_instruction:null,text_state:'ready',text_preview:'shared link',items:[]};
    const shared:BetaShareHandoffsClient={
      list:vi.fn(async()=>[summary]),get:vi.fn(async()=>({...summary,text:'https://example.test',items:[]})),
      bindProfile:vi.fn(async()=>{}),
      acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),
      discard:vi.fn(async()=>{}),cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async()=>vi.fn()),
    };
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} shareHandoffs={shared}/>);

    expect(await screen.findByText('有 1 条系统分享待处理；选择档案后查看内容并继续处理。此处不会显示分享内容。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'选择或创建档案'}));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(client.capture).not.toHaveBeenCalled();
    expect(shared.acknowledgeText).not.toHaveBeenCalled();
  });

  it('returns from another section when a new Android share intent arrives',async()=>{
    const client=fakeClient();let received=false,notify:(id:string)=>void=()=>{};
    const summary:BetaShareHandoffSummary={handoff_id:'share-while-settings',received_at_ms:1234,state:'ready',bound_profile_id:null,profile_match:true,error_code:null,recovery_instruction:null,text_state:'ready',text_preview:'shared text',items:[]};
    const shared:BetaShareHandoffsClient={
      list:vi.fn(async()=>received?[summary]:[]),get:vi.fn(async()=>({...summary,text:'shared text',items:[]})),
      bindProfile:vi.fn(async()=>{}),
      acknowledgeText:vi.fn(async()=>{}),acknowledgeItem:vi.fn(async()=>{}),
      discard:vi.fn(async()=>{}),cancel:vi.fn(async()=>({cancel_requested:true,status:'cancelled'})),onAvailable:vi.fn(async handler=>{notify=handler;return vi.fn();}),
    };
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} shareHandoffs={shared}/>);
    await screen.findByRole('textbox',{name:'记录当下'});
    await waitFor(()=>expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy','false'));
    fireEvent.click(screen.getByRole('button',{name:'设置'}));
    expect(await screen.findByRole('heading',{name:'设置'})).toBeInTheDocument();
    await waitFor(()=>expect(shared.onAvailable).toHaveBeenCalled());

    received=true;
    await act(async()=>{notify('share-while-settings');await Promise.resolve();});

    expect(await screen.findByRole('heading',{name:'系统分享已接收'})).toBeInTheDocument();
    expect(screen.getByRole('textbox',{name:'记录当下'})).toBeVisible();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('uses the existing profile dialog for creation, retains a failed draft there and closes after a confirmed creation',async()=>{
    const client=fakeClient();client.provisionProfile.mockRejectedValueOnce(new Error('synthetic profile failure'));
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client}/>);
    await screen.findByRole('textbox',{name:'记录当下'});expect(screen.queryByRole('textbox',{name:'新档案名称'})).not.toBeInTheDocument();
    expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveAttribute('id','beta-profile');
    const profileEntry = screen.getAllByRole('button',{name:/^打开档案：/});
    expect(profileEntry).toHaveLength(1);
    expect(screen.queryByRole('button',{name:'管理档案'})).not.toBeInTheDocument();
    fireEvent.click(profileEntry[0]);fireEvent.change(screen.getByRole('textbox',{name:'新档案名称'}),{target:{value:'Created in profile dialog'}});
    expect(screen.getByRole('button',{name:'档案备份与导入'})).toBeVisible();
    await waitFor(()=>expect(screen.getByRole('button',{name:'创建档案'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'创建档案'}));
    expect(await within(screen.getByRole('dialog')).findByText('synthetic profile failure')).toBeVisible();expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByRole('textbox',{name:'新档案名称'})).toHaveValue('Created in profile dialog');
    await waitFor(()=>expect(screen.getByRole('button',{name:'创建档案'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'创建档案'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(client.provisionProfile).toHaveBeenCalledTimes(2);expect(client.provisionProfile.mock.calls[1][0]).toBe(client.provisionProfile.mock.calls[0][0]);
    expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue(client.provisionProfile.mock.calls[1][0]);
    act(()=>setBetaDesktopAdaptiveEnabled(false));
    expect(screen.queryByRole('button',{name:'管理档案'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'设置'}));
    fireEvent.click(await screen.findByRole('button',{name:'管理档案'}));
    expect(await screen.findByRole('button',{name:'档案备份与导入'})).toBeVisible();
  });
  it('keeps the sole writer, unsent draft and reading position mounted while opening settings',async()=>{
    const client=fakeClient();
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client}/>);
    const input=await screen.findByRole('textbox',{name:'记录当下'});
    const history=screen.getByLabelText('记录历史');
    await waitFor(()=>expect(history).toHaveAttribute('aria-busy','false'));
    fireEvent.change(input,{target:{value:'unsent while reading'}});
    Object.defineProperties(history,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:200}});
    history.scrollTop=300;fireEvent.scroll(history);
    const calls=client.eventsPage.mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'设置'}));
    expect(screen.getByRole('heading',{name:'设置'})).toBeInTheDocument();
    expect(input).toBeInTheDocument();expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'当下'}));
    expect(screen.getByRole('textbox',{name:'记录当下'})).toBe(input);
    expect(input).toHaveValue('unsent while reading');expect(history.scrollTop).toBe(300);
    expect(client.eventsPage).toHaveBeenCalledTimes(calls);expect(client.capture).not.toHaveBeenCalled();
  });
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
    await selectField(screen.getByRole('combobox', { name: '当前档案' }),'q');
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue('q'));
    fireEvent.change(await screen.findByRole('textbox', { name: '记录当下' }), { target: { value: 'other profile' } });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
    await act(async () => { flight.resolve(saved(client.capture.mock.calls[0][0])); await flight.promise; });
    expect(screen.getByRole('textbox', { name: '记录当下' })).toHaveValue('other profile');
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toBeEnabled());
    await selectField(screen.getByRole('combobox', { name: '当前档案' }),'p');
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前档案'})).toHaveValue('p'));
    expect(await screen.findByRole('textbox', { name: '记录当下' })).toHaveValue('new text');
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));
  });
  it('starts a clean next draft as soon as a capture snapshot is frozen', async () => {
    const client = fakeClient();
    const flight = deferred<BetaReceipt>();
    client.capture.mockReturnValueOnce(flight.promise);
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    await waitFor(() => expect(screen.getByLabelText('记录历史')).toHaveAttribute('aria-busy', 'false'));

    fireEvent.change(input, { target: { value: 'submitted snapshot' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: 'independent next draft' } });
    await act(async () => {
      flight.resolve(saved(client.capture.mock.calls[0][0]));
      await flight.promise;
    });
    expect(input).toHaveValue('independent next draft');
    expect(client.capture.mock.calls[0][0].text).toBe('submitted snapshot');
  });
  it('discards a stale history response after selecting another profile', async () => {
    const client = fakeClient(); const oldPage = deferred<BetaPage>();
    client.eventsPage.mockImplementationOnce(() => oldPage.promise as ReturnType<typeof client.eventsPage>);
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} />);
    const select = await screen.findByRole('combobox', { name: '当前档案' });
    await waitFor(() => expect(client.eventsPage).toHaveBeenCalledTimes(1));
    await selectField(select,'q');
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
    fireEvent.click(screen.getByRole('button',{name:'检索记录'}));
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
