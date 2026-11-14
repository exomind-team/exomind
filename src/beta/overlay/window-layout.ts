import { useCallback,useEffect,useRef,useState,type MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nativeOverlayWindow } from './native-port';

/** Native-only adapter for the same measured surfaces and fallback sizes as
 * Alpha. It does not start dragging: data-tauri-drag-region owns native drag. */
export function useOverlayWindowLayout({mode,mini,peek,expanded,feedback,onError}:{mode:'running'|'idle';mini:boolean;peek:boolean;expanded:boolean;feedback:boolean;onError:(error:unknown)=>void}){
  const [surface,setSurface]=useState<HTMLElement|null>(null),[measurement,setMeasurement]=useState<{key:string;width:number;height:number}|null>(null);
  const [pressed,setPressed]=useState(false),[dragging,setDragging]=useState(false);const draggingPending=useRef(false),glow=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),notify=useRef(onError);notify.current=onError;
  const key=feedback?'feedback':mode==='running'?mini?peek?'running-mini-peek':'running-mini':'running-single-card':expanded?'idle-expanded':'idle-collapsed';
  const onSurfaceMount=useCallback((element:HTMLElement|null)=>setSurface(element),[]);
  const clear=useCallback(()=>{draggingPending.current=false;setPressed(false);setDragging(false);clearTimeout(glow.current);},[]);
  const onSurfaceMouseDownCapture=useCallback((event:MouseEvent<HTMLElement>)=>{if(event.button!==0)return;draggingPending.current=event.target instanceof Element&&!!event.target.closest('[data-tauri-drag-region]');clearTimeout(glow.current);setDragging(false);setPressed(true);},[]);
  useEffect(()=>{window.addEventListener('mouseup',clear);window.addEventListener('blur',clear);return()=>{window.removeEventListener('mouseup',clear);window.removeEventListener('blur',clear);clear();};},[clear]);
  useEffect(()=>{
    if(!surface)return;let frame:number|undefined;const measure=()=>{const rect=surface.getBoundingClientRect();if(rect.width>0&&rect.height>0)setMeasurement(previous=>previous?.key===key&&previous.width===Math.ceil(rect.width)&&previous.height===Math.ceil(rect.height)?previous:{key,width:Math.ceil(rect.width),height:Math.ceil(rect.height)});};
    const schedule=()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};schedule();const observer=new ResizeObserver(schedule);observer.observe(surface);
    return()=>{observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);};
  },[surface,key]);
  useEffect(()=>{
    let disposed=false,unlisten:(()=>void)|undefined,remember:ReturnType<typeof setTimeout>|undefined;
    void getCurrentWindow().onMoved(()=>{if(disposed)return;if(draggingPending.current){setDragging(true);clearTimeout(glow.current);glow.current=setTimeout(clear,180);}clearTimeout(remember);remember=setTimeout(()=>{void nativeOverlayWindow({kind:'remember_position'}).catch(error=>notify.current(error));},250);}).then(cleanup=>{if(disposed)cleanup();else unlisten=cleanup;}).catch(error=>notify.current(error));
    return()=>{disposed=true;unlisten?.();clearTimeout(remember);clearTimeout(glow.current);};
  },[clear]);
  useEffect(()=>{
    const fallback=key==='feedback'?{width:412,height:490}:key==='running-mini-peek'?{width:352,height:200}:key==='running-mini'?{width:248,height:120}:key==='running-single-card'?{width:390,height:192}:key==='idle-expanded'?{width:428,height:360}:{width:276,height:156};
    const size=key!=='feedback'&&measurement?.key===key?measurement:fallback;
    void nativeOverlayWindow({kind:'resize',width:size.width,height:size.height}).catch(error=>notify.current(error));
  },[key,measurement]);
  return{onSurfaceMount,onSurfaceMouseDownCapture,surfaceActive:pressed||dragging};
}
