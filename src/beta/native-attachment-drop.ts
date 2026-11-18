import { useEffect, useState, type RefObject } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { describeNativeFiles } from './native-attachments';
import type { NativeAttachmentFile } from './native-attachment-types';

export function useNativeAttachmentDrop({root,active,onFiles,onError}:{root:RefObject<HTMLElement>;active:boolean;onFiles:(files:NativeAttachmentFile[])=>Promise<void>;onError:(error:unknown)=>void}):boolean {
  const [over,setOver]=useState(false);
  useEffect(()=>{
    if(!active||!isTauri())return;let current=true,unlisten:(()=>void)|undefined;
    const inside=(position:{x:number;y:number})=>{if(document.querySelector('[role="dialog"][data-state="open"]'))return false;const box=root.current?.getBoundingClientRect(),scale=window.devicePixelRatio||1;return !!box&&position.x/scale>=box.left&&position.x/scale<=box.right&&position.y/scale>=box.top&&position.y/scale<=box.bottom;};
    try{
      void getCurrentWebview().onDragDropEvent(event=>{
        const payload=event.payload;if(payload.type==='leave'){setOver(false);return;}
        const accepted=inside(payload.position);if(current)setOver(payload.type!=='drop'&&accepted);
        if(payload.type==='drop'&&accepted&&current){const paths=[...payload.paths];void describeNativeFiles(paths).then(files=>{if(current)return onFiles(files);}).catch(error=>{if(current)onError(error);});}
      }).then(stop=>{if(current)unlisten=stop;else stop();}).catch(()=>{/* The attachment chooser remains available when drag delivery is unsupported. */});
    }catch{/* Browser fixtures and older hosts may not provide a native drag channel. */}
    return()=>{current=false;setOver(false);unlisten?.();};
  },[root,active,onFiles,onError]);
  return over;
}
