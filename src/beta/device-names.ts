import { useMemo, useSyncExternalStore } from 'react';

const PREFIX='exomind:beta:device-names:';
const CHANGE='exomind:beta:device-name-changed';
type Names=Readonly<Record<string,string>>;
function raw(local:string):string {return localStorage.getItem(PREFIX+local)??'{}';}
function parse(value:string):Names {
  const names:unknown=JSON.parse(value);
  if(!names||typeof names!=='object'||Array.isArray(names)||Object.entries(names).some(([id,name])=>!id||typeof name!=='string'||!name.trim()||name.length>80))throw new Error('设备备注无法读取，原缓存已保留；身份和授权不受影响');
  return names as Names;
}
export function deviceName(local:string,target:string,names:Names):string {return names[target]??(local===target?'本机':`未命名设备 ${target.slice(0,8)}`);}
export function saveDeviceName(local:string,target:string,name:string|null):void {
  const names={...parse(raw(local))};
  if(name===null)delete names[target];else{const label=name.trim();if(!label||label.length>80||/[\u0000-\u001f]/.test(label))throw new Error('请输入 1–80 字的设备备注');names[target]=label;}
  localStorage.setItem(PREFIX+local,JSON.stringify(names));window.dispatchEvent(new Event(CHANGE));
}
function subscribe(changed:()=>void){const storage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(PREFIX))changed();};window.addEventListener(CHANGE,changed);window.addEventListener('storage',storage);return()=>{window.removeEventListener(CHANGE,changed);window.removeEventListener('storage',storage);};}
export function useBetaDeviceNames(local:string){
  const snapshot=useSyncExternalStore(subscribe,()=>{try{return raw(local);}catch{return '!unavailable';}},()=> '{}');
  return useMemo(()=>{let names:Names={},error='';try{names=parse(snapshot);}catch{error='设备备注暂时不可读，原缓存已保留';}return{label:(target:string)=>deviceName(local,target,names),error};},[local,snapshot]);
}
