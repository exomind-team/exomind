import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import type { BetaOriginalExportResult } from '@/beta/original-export';
import { MAX_BASIC_DOWNLOAD_BYTES } from '@/beta/original-download';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const locks=Object.getOwnPropertyDescriptor(navigator,'locks');
beforeEach(()=>{localStorage.clear();sessionStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});});
afterEach(()=>{if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');vi.restoreAllMocks();});

describe('Native original export UI',()=>{
  it('enables large originals, discloses cancelled partial documents and cancels only its owned live request on close',async()=>{
    const first=deferred<BetaOriginalExportResult>();const next=deferred<BetaOriginalExportResult>();
    const save=vi.fn((_profile:string,_original:string,_request:string)=>first.promise).mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>next.promise);
    const cancel=vi.fn(async(_request:string)=>true);
    const base=fakeClient();
    base.eventsPage.mockResolvedValue({items:[{event_id:'event',profile_id:'p',device_id:'device-a',author_id:'author',author_kind:'human',occurred_at_ms:Date.now(),text:'fixture',tags:[],digest:'a'.repeat(64),local_seq:1,originals:[{original_id:'original',sha256:'b'.repeat(64),byte_length:MAX_BASIC_DOWNLOAD_BYTES+1,file_name:'large.raw',media_type:'application/octet-stream'}]}],highwater:1,next_before:null});
    const view=render(<BetaApp intentJournal={memoryIntentJournal()} client={{...base,originalExports:{save,cancel}}}/>);
    const button=await screen.findByRole('button',{name:'下载 large.raw'});
    expect(button).toBeEnabled();fireEvent.click(button);
    await screen.findByText('正在流式导出并校验原件…');
    expect(save).toHaveBeenCalledTimes(1);const firstId=save.mock.calls[0][2];
    fireEvent.click(screen.getByRole('button',{name:'取消导出'}));
    await waitFor(()=>expect(cancel).toHaveBeenCalledWith(firstId));
    await act(async()=>{first.resolve({cancelled:true,partial_output:true});});
    expect(await screen.findByText('导出已取消，所选位置可能保留未完成的新文档，请检查后清理')).toBeInTheDocument();
    expect(screen.queryByText('原件已导出并完成校验')).not.toBeInTheDocument();
    await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
    await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));const nextId=save.mock.calls[1][2];
    expect(nextId).not.toBe(firstId);view.unmount();
    expect(cancel).toHaveBeenLastCalledWith(nextId);
    await act(async()=>{next.resolve({cancelled:true,partial_output:false});});
  });
});
