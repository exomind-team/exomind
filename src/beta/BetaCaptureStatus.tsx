import { Tooltip } from '@/components/ui/tooltip';
import { Check, Circle, Clock3, FilePenLine, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/** A fixed input slot reports persistence, never peer delivery. Errors also
 * remain next to their actionable recovery controls in the owning workspace. */
export function BetaCaptureStatus({ message, state }: { message: string; state: 'idle' | 'draft' | 'committed' | 'pending' | 'error' }) {
  const Icon = state === 'error' ? TriangleAlert : state === 'pending' ? Clock3 : state === 'committed' ? Check : state === 'draft' ? FilePenLine : Circle;
  return <Dialog>
    <DialogTrigger asChild><Tooltip content={message}><button type="button" aria-label="记录保存状态"
      data-capture-state={state} className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${state === 'error' ? 'text-destructive' : 'text-secondary hover:text-foreground'}`}>
      <Icon size={15} aria-hidden="true"/><span role="status" className="sr-only">{message}</span>
    </button></Tooltip></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>记录保存状态</DialogTitle><DialogDescription>本机暂存与提交状态，不代表其他设备已收到。</DialogDescription></DialogHeader>
      <p className="text-sm text-strong">{message}</p>
    </DialogContent>
  </Dialog>;
}
