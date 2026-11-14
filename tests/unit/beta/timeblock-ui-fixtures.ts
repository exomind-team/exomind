import { vi } from 'vitest';
import type { LocalIntentJournal } from '@/beta/local-intent-journal';
export function memoryIntentJournal(){
  const values=new Map<string,string>();
  return {values,read:vi.fn(async(key:string)=>values.get(key)??null),write:vi.fn(async(key:string,raw:string)=>{values.set(key,raw);})} satisfies LocalIntentJournal;
}
