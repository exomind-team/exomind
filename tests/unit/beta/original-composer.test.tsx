import { memoryIntentJournal } from './timeblock-ui-fixtures';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import type { FileSourceStore } from '@/beta/file-source-store';
import type { BetaBeginStage, BetaOriginalClient, BetaStage } from '@/beta/original-types';
import { applyKeyboardStateFromSignal } from '@/config/hardware-keyboard';
import { setBetaInputSendMode } from '@/beta/input-preferences';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';

const locks=Object.getOwnPropertyDescriptor(navigator,'locks');
const setHardwareKeyboard=(hasHardwareKeyboard:boolean)=>applyKeyboardStateFromSignal({
  hasHardwareKeyboard,
  keyboardType:hasHardwareKeyboard?'qwerty':'none',
});
beforeEach(()=>setHardwareKeyboard(false));
afterEach(()=>{if(locks)Object.defineProperty(navigator,'locks',locks);else Reflect.deleteProperty(navigator,'locks');localStorage.clear();setHardwareKeyboard(false);});

describe('Beta original composer uses the shared Alpha input',()=>{
  it('restores focus to the same composer after a successful send',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const client=fakeClient();
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    editor.focus();
    fireEvent.change(editor,{target:{value:'发送后继续输入'}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());

    fireEvent.click(screen.getByRole('button',{name:'发送'}));

    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(document.activeElement).toBe(editor));
    expect(editor).toHaveValue('');
  });

  it('inserts an explicit newline for Ctrl+Enter when Enter-send is selected',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    localStorage.setItem('exomind:beta:input-send-mode','enter-send');
    const client=fakeClient();
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(editor,{target:{value:'第一行'}});
    editor.setSelectionRange(3,3);

    fireEvent.keyDown(editor,{key:'Enter',ctrlKey:true});

    expect(editor).toHaveValue('第一行\n');
    expect(client.capture).not.toHaveBeenCalled();
    await waitFor(()=>expect(document.activeElement).toBe(editor));
    expect(editor.selectionStart).toBe(4);
  });

  it('uses the hardware-keyboard state only as the adaptive fallback',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const client=fakeClient();
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(editor,{target:{value:'触摸输入'}});

    fireEvent.keyDown(editor,{key:'Enter'});
    expect(editor).toHaveValue('触摸输入');
    expect(client.capture).not.toHaveBeenCalled();

    act(()=>setHardwareKeyboard(true));
    fireEvent.keyDown(editor,{key:'Enter'});
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));

    fireEvent.change(editor,{target:{value:'外接键盘'}});
    act(()=>setHardwareKeyboard(false));
    fireEvent.keyDown(editor,{key:'Enter'});
    expect(editor).toHaveValue('外接键盘');
    expect(client.capture).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(editor,{key:'Enter',ctrlKey:true});
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(2));

    act(()=>setBetaInputSendMode('ctrl-enter-send'));
    act(()=>setHardwareKeyboard(true));
    fireEvent.change(editor,{target:{value:'显式选择优先'}});
    fireEvent.keyDown(editor,{key:'Enter'});
    expect(editor).toHaveValue('显式选择优先');
    expect(client.capture).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(editor,{key:'Enter',ctrlKey:true});
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(3));
  });

  it('B14-A01: dropping a file anywhere in Now mounts it without submitting or replacing typed text',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const blobs=new Map<string,Blob>();
    const sourceStore:FileSourceStore={put:async(key,blob)=>{blobs.set(key,blob);},get:async key=>blobs.get(key)??null,remove:async key=>{blobs.delete(key);}};
    const stages=new Map<string,BetaStage>();
    const originals:BetaOriginalClient={
      begin:async input=>{const stage:BetaStage={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1};stages.set(input.stage_id,stage);return stage;},
      status:async(_p,id)=>stages.get(id)!,write:async()=>{throw Error('empty fixture');},verify:async(_p,id)=>({...stages.get(id)!,state:'verified'}),readStage:async()=>new Uint8Array(),readOriginal:async()=>new Uint8Array(),
    };
    const client={...fakeClient(),originals};
    const ui=render(<BetaApp intentJournal={memoryIntentJournal()} client={client} sourceStore={sourceStore}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(editor,{target:{value:'keep my draft'}});
    fireEvent.drop(ui.container.querySelector('[data-beta-workspace]')!,{dataTransfer:{types:['Files'],files:[new File([],'dropped.zip',{type:'application/zip'})]}});
    expect(await screen.findByText('dropped.zip')).toBeVisible();
    await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());
    expect(editor).toHaveValue('keep my draft');expect(client.capture).not.toHaveBeenCalled();
  });
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
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} sourceStore={sourceStore}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    expect(screen.getByTestId('new-now-input-row')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'附件'})).toBeEnabled();
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File([],'unknown.custom')]}});
    expect(await screen.findByText('unknown.custom')).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());
    editor.focus();fireEvent.click(screen.getByRole('button',{name:'发送'}));
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(document.activeElement).toBe(editor));
    expect(client.capture.mock.calls[0][0].text).toBe('');
    expect(client.capture.mock.calls[0][0].originals?.map(item=>item.file_name)).toEqual(['unknown.custom']);
    expect(await screen.findByText('本机已保存')).toBeInTheDocument();
  });
  it('queues an explicit pre-send while the local attachment copy is still preparing',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const blobs=new Map<string,Blob>();
    const copyStarted=deferred<void>(),copyGate=deferred<void>();
    const sourceStore:FileSourceStore={
      put:async(key,blob)=>{copyStarted.resolve();await copyGate.promise;blobs.set(key,blob.slice());},
      get:async key=>blobs.get(key)??null,
      remove:async key=>{blobs.delete(key);},
    };
    let stage:BetaStage|undefined;
    const originals:BetaOriginalClient={
      begin:async input=>stage??={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1},
      status:async()=>stage!,
      write:async(_profile,id,offset,bytes)=>{stage={...stage!,next_offset:offset+bytes.length};return stage;},
      verify:async()=>({...stage!,state:'verified'}),
      readStage:async()=>new Uint8Array(),
      readOriginal:async()=>new Uint8Array(),
    };
    const client={...fakeClient(),originals};
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} sourceStore={sourceStore}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(editor,{target:{value:'等待附件但先预发送'}});
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File(['attachment body'],'waiting.txt',{type:'text/plain'})]}});
    await copyStarted.promise;

    const send=screen.getByRole('button',{name:'发送'});
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect((await screen.findAllByText(/预发送已排队.*等待附件本机校验完成/)).length).toBeGreaterThan(0);
    expect(client.capture).not.toHaveBeenCalled();

    copyGate.resolve();
    await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
    expect(client.capture.mock.calls[0][0].text).toBe('等待附件但先预发送');
    expect(client.capture.mock.calls[0][0].originals?.map(item=>item.file_name)).toEqual(['waiting.txt']);
  });
  it('cancels a preparing pre-send without sending old text when the draft changes',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const blobs=new Map<string,Blob>();
    const copyStarted=deferred<void>(),copyGate=deferred<void>();
    const sourceStore:FileSourceStore={
      put:async(key,blob)=>{copyStarted.resolve();await copyGate.promise;blobs.set(key,blob.slice());},
      get:async key=>blobs.get(key)??null,
      remove:async key=>{blobs.delete(key);},
    };
    let stage:BetaStage|undefined;
    const originals:BetaOriginalClient={
      begin:async input=>stage??={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1},
      status:async()=>stage!,
      write:async(_profile,id,offset,bytes)=>{stage={...stage!,next_offset:offset+bytes.length};return stage;},
      verify:async()=>({...stage!,state:'verified'}),
      readStage:async()=>new Uint8Array(),
      readOriginal:async()=>new Uint8Array(),
    };
    const client={...fakeClient(),originals};
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} sourceStore={sourceStore}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(editor,{target:{value:'不应误发的旧文本'}});
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File(['attachment body'],'cancel.txt',{type:'text/plain'})]}});
    await copyStarted.promise;
    fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect((await screen.findAllByText(/预发送已排队.*等待附件本机校验完成/)).length).toBeGreaterThan(0);

    fireEvent.change(editor,{target:{value:'不应误发的旧文本\n\n新的当前意图'}});
    expect(await screen.findByText(/预发送已取消.*当前输入未发送/)).toBeInTheDocument();
    copyGate.resolve();
    await waitFor(()=>expect(screen.getByText(/附件已校验就绪 · 记录尚未提交/)).toBeInTheDocument());
    expect(editor).toHaveValue('不应误发的旧文本\n\n新的当前意图');
    expect(client.capture).not.toHaveBeenCalled();
  });
  it('keeps the composer focused while queued and cancels an unsubmitted pre-send when new text arrives',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const bytes=new Uint8Array([1,2,3,4]);
    const blobs=new Map<string,Blob>();
    const sourceStore:FileSourceStore={put:async(key,blob)=>{blobs.set(key,blob);},get:async key=>blobs.get(key)??null,remove:async key=>{blobs.delete(key);}};
    let stage:BetaStage|undefined;
    const uploadStarted=deferred<void>(),uploadGate=deferred<BetaStage>();
    const originals:BetaOriginalClient={
      begin:async(input:BetaBeginStage)=>stage??={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1},
      status:async()=>stage!,
      write:async(_profile,id,offset,chunk)=>{uploadStarted.resolve();stage=await uploadGate.promise;return stage;},
      verify:async()=>({...stage!,state:'verified'}),readStage:async()=>new Uint8Array(),readOriginal:async()=>new Uint8Array(),
    };
    const client={...fakeClient(),originals};
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} sourceStore={sourceStore}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(editor,{target:{value:'已固定的原文'}});
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File([bytes],'queued.apk',{type:'application/vnd.android.package-archive'})]}});

    try {
      await uploadStarted.promise;
      await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());
      editor.focus();
      fireEvent.keyDown(editor,{key:'Enter',ctrlKey:true});

      await waitFor(()=>expect(document.activeElement).toBe(editor));
      expect(await screen.findByText('已固定的原文')).toBeInTheDocument();
      expect(screen.getByRole('progressbar',{name:'附件准备进度 queued.apk'})).toBeInTheDocument();
      expect(client.capture).not.toHaveBeenCalled();

      editor.focus();
      fireEvent.change(editor,{target:{value:'下一条新内容'}});
      expect(editor).toHaveValue('已固定的原文\n\n下一条新内容');
      expect(screen.getByText(/上一条预发送已取消/)).toBeInTheDocument();
      expect(screen.queryByText('已固定的原文')).not.toBeInTheDocument();
      expect(client.capture).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button',{name:'同步'}));
      expect(document.querySelector('[data-beta-view="now"]')).toHaveAttribute('hidden');
      expect(client.capture).not.toHaveBeenCalled();

      uploadGate.resolve({...stage!,next_offset:bytes.length});
      expect(client.capture).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button',{name:'当下'}));
      await waitFor(()=>expect(screen.getByText(/附件已校验就绪 · 记录尚未提交/)).toBeInTheDocument());
      expect(editor).toHaveValue('已固定的原文\n\n下一条新内容');
      fireEvent.click(screen.getByRole('button',{name:'发送'}));
      await waitFor(()=>expect(client.capture).toHaveBeenCalledTimes(1));
      expect(client.capture.mock.calls[0][0].text).toBe('已固定的原文\n\n下一条新内容');
      expect(client.capture.mock.calls[0][0].originals).toHaveLength(1);
      expect(editor).toHaveValue('');
    } finally {
      if(stage) uploadGate.resolve({...stage,next_offset:bytes.length});
    }
  });
  it('offers same-file retry after bounded local-copy attempts and distinguishes ready attachment from committed record',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const blobs=new Map<string,Blob>();let putAttempts=0;
    const sourceStore:FileSourceStore={
      put:async(key,blob)=>{putAttempts++;if(putAttempts<=4)throw{code:'source_store_unavailable',message:'synthetic transient local-copy failure'};blobs.set(key,blob.slice());},
      get:async key=>blobs.get(key)??null,remove:async key=>{blobs.delete(key);},
    };
    const stages=new Map<string,BetaStage>(),stageBytes=new Map<string,Uint8Array>();
    const originals:BetaOriginalClient={
      begin:async input=>{const existing=stages.get(input.stage_id);if(existing)return existing;const stage:BetaStage={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1};stages.set(input.stage_id,stage);stageBytes.set(input.stage_id,new Uint8Array());return stage;},
      status:async(_profile,id)=>stages.get(id)!,
      write:async(_profile,id,offset,bytes)=>{const old=stageBytes.get(id)!;if(offset!==old.length)throw new Error('synthetic stage offset mismatch');const next=new Uint8Array(old.length+bytes.length);next.set(old);next.set(bytes,old.length);stageBytes.set(id,next);const stage={...stages.get(id)!,next_offset:next.length};stages.set(id,stage);return stage;},
      verify:async(_profile,id)=>{const stage={...stages.get(id)!,state:'verified' as const};stages.set(id,stage);return stage;},
      readStage:async(_profile,id,offset,length)=>stageBytes.get(id)!.slice(offset,offset+length),
      readOriginal:async(_profile,id,offset,length)=>stageBytes.get(id)!.slice(offset,offset+length),
    };
    const client={...fakeClient(),originals};
    render(<BetaApp intentJournal={memoryIntentJournal()} client={client} sourceStore={sourceStore}/>);
    await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File(['same source bytes'],'retry-same-file.webp',{type:'image/webp'})]}});

    const retry=await screen.findByRole('button',{name:'重试上传'},{timeout:5000});
    expect(retry).toBeEnabled();expect(screen.getByRole('button',{name:'重新选择'})).toBeEnabled();
    expect(putAttempts).toBe(4);expect(client.capture).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(await screen.findByText(/附件已校验就绪 · 记录尚未提交/)).toBeInTheDocument();
    await waitFor(()=>expect(putAttempts).toBe(5));
    expect(client.capture).not.toHaveBeenCalled();
  });
  it('recovers only the selected failed attachment and preserves edits made during the retry',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const blobs=new Map<string,Blob>();
    const getSource=vi.fn(async(key:string)=>blobs.get(key)??null);
    const sourceStore:FileSourceStore={put:vi.fn(async(key,blob)=>{blobs.set(key,blob);}),get:getSource,remove:vi.fn(async key=>{blobs.delete(key);})};
    const stages=new Map<string,BetaStage>();
    const attempts=new Map<string,number>();
    let firstStageId='';
    const recoveryWrite=deferred<BetaStage>(),recoveryStarted=deferred<void>();
    const writeOriginal=vi.fn(async(_profile:string,stageId:string,offset:number,bytes:Uint8Array)=>{
      const attempt=(attempts.get(stageId)??0)+1;attempts.set(stageId,attempt);
      if(attempt===1)throw new Error('synthetic first attempt failure');
      if(stageId===firstStageId&&attempt===2){recoveryStarted.resolve();const result=await recoveryWrite.promise;stages.set(stageId,result);return result;}
      const result={...stages.get(stageId)!,next_offset:offset+bytes.byteLength};stages.set(stageId,result);return result;
    });
    const verifyOriginal=vi.fn(async(_profile:string,id:string)=>({...stages.get(id)!,state:'verified' as const}));
    const originals:BetaOriginalClient={
      begin:vi.fn(async(input:BetaBeginStage)=>{
        const previous=stages.get(input.stage_id);if(previous)return previous;
        const stage:BetaStage={stage_id:input.stage_id,profile_id:input.profile_id,original:{original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type},state:'uploading',next_offset:0,generation:1};
        stages.set(input.stage_id,stage);if(input.file_name==='first.txt')firstStageId=input.stage_id;return stage;
      }),
      status:async(_profile,id)=>stages.get(id)!,
      write:writeOriginal,
      verify:verifyOriginal,
      readStage:async()=>new Uint8Array(),readOriginal:async()=>new Uint8Array(),
    };
    const client={...fakeClient(),originals};
    const journal=memoryIntentJournal(),journalKey='exomind:beta:drafts:device-a';
    const readDraft=()=>{
      const raw=journal.values.get(journalKey);if(!raw)throw new Error('draft journal has not committed');
      return JSON.parse(raw) as {drafts:Record<string,{text:string;files:Array<{id:string;stage_id:string;source_key:string;file_name:string;byte_length:number;media_type:string;original?:unknown;state:string;next_offset:number;message?:string}>}>};
    };
    render(<BetaApp intentJournal={journal} client={client} sourceStore={sourceStore}/>);
    const editor=await screen.findByRole('textbox',{name:'记录当下'});
    fireEvent.change(screen.getByLabelText('选择原件'),{target:{files:[new File(['first body'],'first.txt',{type:'text/plain'}),new File(['second body'],'second.txt',{type:'text/plain'})]}});
    await waitFor(()=>expect(readDraft().drafts.p.files.map(file=>file.state)).toEqual(['failed','failed']));
    const before=readDraft().drafts.p.files.map(file=>({...file}));
    const targetBefore=before[0]!,otherBefore=before[1]!;
    const readsBefore=new Map(before.map(file=>[file.source_key,getSource.mock.calls.filter(([key])=>key===file.source_key).length]));
    expect(firstStageId).toBe(targetBefore.stage_id);
    const targetRow=screen.getByText('first.txt').parentElement?.parentElement;
    expect(targetRow).not.toBeNull();
    fireEvent.click(within(targetRow!).getByRole('button',{name:'重试上传'}));
    await recoveryStarted.promise;
    fireEvent.change(editor,{target:{value:'文字在恢复期间继续编辑'}});
    await act(async()=>{
      recoveryWrite.resolve({...stages.get(firstStageId)!,next_offset:targetBefore.byte_length});
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    });
    await waitFor(()=>expect(readDraft().drafts.p.files[0].state).toBe('verified'));

    const after=readDraft().drafts.p;
    const identity=(file:typeof before[number])=>({id:file.id,stage_id:file.stage_id,source_key:file.source_key,file_name:file.file_name,byte_length:file.byte_length,media_type:file.media_type,original:file.original});
    expect(after.files.map(identity)).toEqual(before.map(identity));
    expect(after.files[1]).toEqual(otherBefore);
    expect(after.files[0].state).toBe('verified');
    expect(after.text).toBe('文字在恢复期间继续编辑');
    expect(editor).toHaveValue('文字在恢复期间继续编辑');
    expect(writeOriginal.mock.calls.map(([,stageId])=>stageId)).toEqual([targetBefore.stage_id,otherBefore.stage_id,targetBefore.stage_id]);
    expect(verifyOriginal.mock.calls.map(([,stageId])=>stageId)).toEqual([targetBefore.stage_id]);
    expect(getSource.mock.calls.filter(([key])=>key===targetBefore.source_key)).toHaveLength(readsBefore.get(targetBefore.source_key)!+1);
    expect(getSource.mock.calls.filter(([key])=>key===otherBefore.source_key)).toHaveLength(readsBefore.get(otherBefore.source_key)!);
    expect(client.capture).not.toHaveBeenCalled();
  });
});
