import type { FileSourceStore } from './file-source-store';
import type { FileSourceWork } from './attachment-progress';
import type { BetaBeginStage, BetaStage } from './original-types';

export interface NativeAttachmentFile { kind:'native_file'; path:string; name:string; size:number; type:string }
export type AttachmentSelection = File | NativeAttachmentFile;
export function isNativeAttachment(file:AttachmentSelection):file is NativeAttachmentFile { return 'kind' in file&&file.kind==='native_file'; }
/** Native byte work stays beside its storage; browsers keep the bounded Blob path. */
export interface NativeAttachmentSources extends FileSourceStore {
  importFile(key:string,file:NativeAttachmentFile,work:FileSourceWork):Promise<void>;
  verifySource(key:string,work:FileSourceWork):Promise<{size:number;sha256:string}>;
  stageLocalSource(key:string,command:BetaBeginStage,work:FileSourceWork):Promise<{stage:BetaStage;cleanupConfirmed:boolean}>;
}
export function hasNativeAttachmentSources(store:FileSourceStore):store is NativeAttachmentSources {
  return 'importFile' in store&&typeof store.importFile==='function'&&'verifySource' in store&&typeof store.verifySource==='function'&&'stageLocalSource' in store&&typeof store.stageLocalSource==='function';
}
