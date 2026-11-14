import { useEffect,useRef,useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import type { BetaClient } from '../client';
import type { BetaDraftController } from '../drafts';
import type { BetaTimeblockController } from '../timeblocks-controller';
import { connectMainOverlay } from './main-owner';
import { nativeMainOverlayPort,nativeOverlayWindow } from './native-port';

/** Mounted under DeviceWorkspace's writer lock, never in the overlay entry. */
export function MainOverlayBridge({client,capture,focus,profileId,onCommitted}:{client:BetaClient;capture:BetaDraftController;focus:BetaTimeblockController;profileId:string;onCommitted:()=>void}){
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const previous=useRef<Promise<void>|null>(null);const notify=useRef(onCommitted);notify.current=onCommitted;
  const desktop=isTauri()&&!/Android|iPhone|iPad/i.test(navigator.userAgent);
  useEffect(()=>{
    if(!desktop)return;let cancelled=false;let connected:Awaited<ReturnType<typeof connectMainOverlay>>|undefined;
    const last=previous.current;
    const opening=(async()=>{
      if(last)await last.catch(()=>{});if(cancelled)return;
      const identity=await client.status();if(cancelled)return;
      if(!identity.runtime_id)throw new Error('本机服务身份未就绪');
      connected=await connectMainOverlay({port:nativeMainOverlayPort(),binding:{device_id:identity.device_id,runtime_id:identity.runtime_id,profile_id:profileId},client,capture,focus,dark:()=>document.documentElement.classList.contains('dark'),onCommitted:()=>notify.current(),onReady:()=>{if(!cancelled){setReady(true);setError('');}},onError:failure=>{if(!cancelled){setReady(false);setError(failure instanceof Error?failure.message:'浮窗桥暂不可用');}}});
      if(cancelled){connected.close();return;}setReady(true);setError('');
    })();previous.current=opening;void opening.catch(failure=>{if(!cancelled){setError(failure instanceof Error?failure.message:'浮窗桥暂不可用');setReady(false);}});
    return()=>{cancelled=true;setReady(false);connected?.close();};
  },[desktop,client,capture,focus,profileId,attempt]);
  if(!desktop)return null;
  return<div className="flex flex-wrap items-center gap-2 px-5 py-1 text-xs text-secondary"><Button size="sm" variant="ghost" disabled={!ready} onClick={()=>{void nativeOverlayWindow({kind:'show'}).catch(failure=>setError(failure instanceof Error?failure.message:'浮窗未能打开'));}}>专注浮窗</Button>{error&&<><span role="alert" className="text-destructive">{error}</span><Button size="sm" variant="outline" onClick={()=>setAttempt(value=>value+1)}>重试浮窗桥</Button></>}</div>;
}
