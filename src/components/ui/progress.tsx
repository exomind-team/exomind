import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Progress({value,max=100,className,...props}:Omit<HTMLAttributes<HTMLDivElement>,'children'> & {value?:number;max?:number}) {
  const limit=Math.max(1,max),current=value===undefined?undefined:Math.max(0,Math.min(limit,value));
  return <div {...props} role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={current} aria-valuetext={current===undefined?'进度尚未确定':undefined} className={cn('relative h-1 overflow-hidden rounded-full bg-border-card',className)}>
    <div aria-hidden className={cn('h-full rounded-full bg-brand-accent',current===undefined&&'w-full opacity-40 motion-safe:animate-pulse')} style={current===undefined?undefined:{width:`${100*current/limit}%`}}/>
  </div>;
}
