import { useEffect, useRef, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BetaProfile } from './client';

export function BetaProfileDialog({ open, onOpenChange, profiles, profileId, loading, disabled, creating, name, onNameChange, onCreate, onSelect }: {
  open:boolean;onOpenChange:(open:boolean)=>void;profiles:BetaProfile[];profileId:string;loading:boolean;disabled:boolean;creating:boolean;
  name:string;onNameChange:(name:string)=>void;onCreate:(event:FormEvent)=>Promise<void>;onSelect:(profileId:string)=>Promise<boolean>;
}) {
  const openedProfile=useRef(profileId);
  useEffect(()=>{if(!open)openedProfile.current=profileId;else if(profileId!==openedProfile.current)onOpenChange(false);},[open,profileId,onOpenChange]);
  return <Dialog open={open} onOpenChange={next=>{if(!creating)onOpenChange(next);}}>
    <DialogContent><DialogHeader><DialogTitle>打开档案</DialogTitle><DialogDescription>切换前会确认当前草稿已在本机暂存。同名档案仍分别保存。</DialogDescription></DialogHeader>
      {loading?<p role="status" className="text-sm text-muted">正在读取档案…</p>:<div className="space-y-2">{profiles.length===0?<p className="text-sm text-secondary">还没有本机档案。</p>:profiles.map(profile=><Button key={profile.profile_id} variant="ghost" className="h-auto w-full justify-between py-3 text-left" disabled={disabled||creating} onClick={()=>{void onSelect(profile.profile_id).then(selected=>{if(selected)onOpenChange(false);});}}><span className="min-w-0 truncate">{profile.display_name}</span>{profile.profile_id===profileId&&<Check size={16} aria-label="当前档案"/>}</Button>)}</div>}
      <form onSubmit={event=>{void onCreate(event);}} className="space-y-3 border-t border-border-card pt-4">
        <label htmlFor="beta-dialog-profile-name" className="text-sm font-medium text-foreground">创建本机档案</label>
        <Input id="beta-dialog-profile-name" aria-label="新档案名称" value={name} maxLength={200} onChange={event=>onNameChange(event.target.value)} placeholder="档案名称" disabled={creating}/>
        <Button type="submit" disabled={disabled||creating||!name.trim()}>{creating?'创建中…':'创建档案'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
