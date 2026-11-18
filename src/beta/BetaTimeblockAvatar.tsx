import { AlarmClock, Check, ClipboardList, Pause, Play, RotateCw, Square, type LucideIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { BetaTimeblockNode } from './timeblocks-types';

const styles = {
  start: { icon: Play, color: 'bg-emerald-600 text-white' },
  resume: { icon: Play, color: 'bg-emerald-600 text-white' },
  pause: { icon: Pause, color: 'bg-amber-500 text-stone-950' },
  end_action: { icon: Square, color: 'bg-red-700 text-white' },
  rotate: { icon: RotateCw, color: 'bg-cyan-700 text-white' },
  submit_feedback: { icon: Check, color: 'bg-blue-700 text-white' },
  append_feedback: { icon: ClipboardList, color: 'bg-blue-700 text-white' },
} satisfies Record<string, { icon: LucideIcon; color: string }>;

export function BetaTimeblockAvatar({ node }: { node: BetaTimeblockNode }) {
  const { icon: Icon, color } = node.payload.kind === 'action' ? styles[node.payload.action.kind] : { icon: AlarmClock, color: 'bg-amber-500 text-stone-950' };
  return <Avatar className="mt-0.5 h-8 w-8 shrink-0"><AvatarFallback className={color}><Icon size={16} aria-hidden="true"/></AvatarFallback></Avatar>;
}
