import type { FileSourceStore } from './file-source-store';
import type { FileSourceWork } from './attachment-progress';
import type { BetaBeginStage, BetaStage } from './original-types';

export interface NativeAttachmentFile { kind:'native_file'; path:string; name:string; size:number; type:string }
/** Opaque source handle from an Android share handoff. It intentionally carries
 * no content URI, filesystem path or permission token into React. */
export interface SharedHandoffAttachmentFile {
  kind:'shared_handoff_file';
  handoffId:string;
  itemId:string;
  profileId:string;
  name:string;
  size:number;
  type:string;
}
export type AttachmentSelection = File | NativeAttachmentFile | SharedHandoffAttachmentFile;
export function isNativeAttachment(file:AttachmentSelection):file is NativeAttachmentFile { return 'kind' in file&&file.kind==='native_file'; }
export function isSharedHandoffAttachment(file:AttachmentSelection):file is SharedHandoffAttachmentFile { return 'kind' in file&&file.kind==='shared_handoff_file'; }
/** Native byte work stays beside its storage; browsers keep the bounded Blob path. */
export interface NativeAttachmentSources extends FileSourceStore {
  importFile(key:string,file:NativeAttachmentFile,work:FileSourceWork):Promise<void>;
  importSharedHandoff?(key:string,file:SharedHandoffAttachmentFile,work:FileSourceWork):Promise<void>;
  verifySource(key:string,work:FileSourceWork):Promise<{size:number;sha256:string}>;
  stageLocalSource(key:string,command:BetaBeginStage,work:FileSourceWork):Promise<{stage:BetaStage;cleanupConfirmed:boolean}>;
}
export function hasNativeAttachmentSources(store:FileSourceStore):store is NativeAttachmentSources {
  return 'importFile' in store&&typeof store.importFile==='function'&&'verifySource' in store&&typeof store.verifySource==='function'&&'stageLocalSource' in store&&typeof store.stageLocalSource==='function';
}
