import { Tooltip } from '@/components/ui/tooltip';
import { useId, type ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { cn } from '@/lib/utils';

export interface FieldSelectOption { value:string; label:ReactNode; disabled?:boolean }
export function FieldSelect({value,onValueChange,options,label,id,title,disabled,className}:{value:string;onValueChange:(value:string)=>void;options:readonly FieldSelectOption[];label:string;id?:string;title?:string;disabled?:boolean;className?:string}) {
  const empty=useId();
  return <Select value={value||empty} disabled={disabled} onValueChange={next=>onValueChange(next===empty?'':next)}>
    <Tooltip content={title}><SelectTrigger id={id} aria-label={label}  value={value} className={cn('h-8 w-auto min-w-0 gap-2 rounded-lg px-2 text-xs',className)}><SelectValue placeholder="请选择"/></SelectTrigger></Tooltip>
    <SelectContent>{options.map(option=><SelectItem key={option.value||empty} value={option.value||empty} data-option-value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
