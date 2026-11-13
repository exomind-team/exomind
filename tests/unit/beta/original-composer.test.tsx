import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import type { FileSourceStore } from '@/beta/file-source-store';
import type { BetaBeginStage, BetaOriginalClient, BetaStage } from '@/beta/original-types';
import { asyncDraftLocks, fakeClient } from './fixtures';

const locks=Object.getOwnPropertyDescriptor(navigator,'locks');
afterEach(()=>{if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');localStorage.clear();});

describe('Beta original composer uses the shared Alpha input',()=>{
  it('selects an unknown empty file and submits a real file-only immutable command',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const blobs=new Map<string,Blob>();
    const sourceStore:FileSourceStore={put:async(key,blob)=>{blobs.set(key,blob);},get:async key=>blobs.get(key)??null,remove:async key=>{blobs.delete(key);}};
    const stages=new Map<string,BetaStage>();
    const originals:BetaOriginalClient={
      begin:vi.fn(async(input:BetaBeginStage)=>{const stage:BetaStage={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1};stages.set(input.stage_id,stage);return stage;}),
      status:async(_profile,id)=>stages.get(id)!,write:async()=>{throw new Error('empty file must not upload chunks');},
      verify:async(_profile,id)=>({...stages.get(id)!,state:'verified'}),readStage:async()=>new Uint8Array(),readOriginal:async()=>new Uint8Array(),
    };
    const client={...fakeClient(),originals};
    render(<BetaApp client={client} sourceStore={sourceStore}/>);
    await screen.findByRole('textbox',{name:'记录当下'});
    expect(screen.getByTestId('new-now-input-row')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'附件'})).toBeEnabled();
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File([],'unknown.custom')]}});
    expect(await screen.findByText('unknown.custom')).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'发送'}));
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
    expect(client.capture.mock.calls[0][0].text).toBe('');
    expect(client.capture.mock.calls[0][0].originals?.map(item=>item.file_name)).toEqual(['unknown.custom']);
    expect(await screen.findByText('本机已保存')).toBeInTheDocument();
  });
});
