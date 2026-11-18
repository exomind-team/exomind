import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { saveDeviceName,useBetaDeviceNames } from './device-names';
import { errorMessage } from './drafts';

export function BetaDeviceName({localDeviceId,deviceId}:{localDeviceId:string;deviceId:string}) {
  const names=useBetaDeviceNames(localDeviceId),[open,setOpen]=useState(false),[text,setText]=useState(''),[error,setError]=useState('');
  function save(){try{saveDeviceName(localDeviceId,deviceId,text);setOpen(false);setError('');}catch(failure){setError(errorMessage(failure));}}
  return <><span className="inline-flex min-w-0 items-center gap-1"><span className="truncate">{names.label(deviceId)}</span><Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`命名 ${names.label(deviceId)}`} onClick={()=>{setText('');setError('');setOpen(true);}}><Pencil size={12}/></Button></span>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>设备备注</DialogTitle><DialogDescription>为这台设备取一个可辨认的名称。仅在本机显示，身份和授权保持不变。</DialogDescription></DialogHeader>
      <form onSubmit={event=>{event.preventDefault();save();}} className="space-y-3"><Input autoFocus aria-label="设备备注" value={text} placeholder={names.label(deviceId)} maxLength={80} onChange={event=>setText(event.target.value)}/><details className="text-xs text-muted"><summary>设备身份</summary><p className="break-all">{deviceId}</p></details>{(error||names.error)&&<p role="alert" className="text-xs text-destructive">{error||names.error}</p>}<DialogFooter><Button type="button" variant="ghost" onClick={()=>setOpen(false)}>取消</Button><Button type="submit" disabled={!text.trim()||!!names.error}>保存备注</Button></DialogFooter></form>
    </DialogContent></Dialog>
  </>;
}
