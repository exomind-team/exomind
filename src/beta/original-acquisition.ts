import { BetaApiError } from './api-error';
import { validateOriginal } from './original-client';
import type { BetaOriginal } from './original-types';
import { nativeBetaPeersClient } from './peers-client';
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface BetaOriginalTransferStatus {
  profile_id: string;
  original_id: string;
  original: BetaOriginal;
  availability: 'missing' | 'partial' | 'complete' | 'hash_mismatch';
  next_offset: number;
  byte_length: number;
  request_id: string | null;
  peer_device_id: string | null;
  transfer_state: 'idle' | 'receiving' | 'verifying' | 'confirming' | 'failed' | 'cancelled';
  last_error_code: string | null;
}
export interface BetaOriginalFetchResult { original: BetaOriginal; verified: boolean; resumed_from: number; transferred_bytes: number }
export interface BetaOriginalSources { network_enabled: boolean; devices: string[] }
export interface BetaOriginalAcquisitionClient {
  status(profileId: string, originalId: string): Promise<BetaOriginalTransferStatus>;
  sources(profileId: string): Promise<BetaOriginalSources>;
  fetch(profileId: string, originalId: string, peerDeviceId: string, requestId: string): Promise<BetaOriginalFetchResult>;
  fetchAny?(profileId:string,originalId:string,requestId:string,onAttempt:(attempt:{index:number;total:number;deviceId:string})=>void):Promise<BetaOriginalFetchResult>;
  observe?(profileId:string,originalId:string,onChanged:()=>void):Promise<()=>void>;
  cancel(profileId: string, originalId: string, requestId: string): Promise<boolean>;
}
type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const activeStates = ['receiving', 'verifying', 'confirming'];
export function originalTransferActive(status: BetaOriginalTransferStatus): boolean { return activeStates.includes(status.transfer_state); }
function invalid(): never { throw new BetaApiError('invalid_original_transfer_response', '原件获取状态尚未确认，请重新检查'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result=value as Record<string,unknown>;
  if(Object.keys(result).some(key=>!keys.includes(key))||keys.some(key=>!(key in result)))return invalid();
  return result;
}
function integer(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<0)return invalid();return Number(value);}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)||value==='00000000-0000-0000-0000-000000000000')return invalid();return value;}
export function sameOriginal(a:BetaOriginal,b:BetaOriginal):boolean{return a.original_id===b.original_id&&a.sha256===b.sha256&&a.byte_length===b.byte_length&&a.file_name===b.file_name&&a.media_type===b.media_type;}
export function nativeOriginalAcquisition(call:Call):BetaOriginalAcquisitionClient{
  const peers=nativeBetaPeersClient(call);
  return{
    async status(profileId,originalId){
      const raw=object(await call('beta_peer_original_status',{profileId,originalId}),['profile_id','original_id','original','availability','next_offset','byte_length','request_id','peer_device_id','transfer_state','last_error_code']);
      const original=validateOriginal(raw.original);const offset=integer(raw.next_offset);const length=integer(raw.byte_length);
      if(raw.profile_id!==profileId||raw.original_id!==originalId||original.original_id!==originalId||length!==original.byte_length||offset>length
        ||!['missing','partial','complete','hash_mismatch'].includes(String(raw.availability))||!['idle',...activeStates,'failed','cancelled'].includes(String(raw.transfer_state))
        ||raw.availability==='complete'&&offset!==length||raw.availability==='missing'&&offset!==0
        ||raw.last_error_code!==null&&(typeof raw.last_error_code!=='string'||raw.last_error_code.length>128))return invalid();
      const request=raw.request_id===null?null:uuid(raw.request_id);const peer=raw.peer_device_id===null?null:uuid(raw.peer_device_id);
      if(activeStates.includes(String(raw.transfer_state))&&(!request||!peer))return invalid();
      return{profile_id:profileId,original_id:originalId,original,availability:raw.availability as BetaOriginalTransferStatus['availability'],next_offset:offset,byte_length:length,request_id:request,peer_device_id:peer,transfer_state:raw.transfer_state as BetaOriginalTransferStatus['transfer_state'],last_error_code:raw.last_error_code as string|null};
    },
    async sources(profileId){const status=await peers.status(profileId);return{network_enabled:status.network_enabled,devices:status.peers.filter(peer=>peer.member_state==='ready').map(peer=>peer.device_id)};},
    async observe(profileId,originalId,onChanged){return listen<{profile_id:string|null;original_id:string|null}>('beta-original-availability-changed',event=>{const value=event.payload;if(value&&typeof value==='object'&&(value.profile_id===null||value.profile_id===profileId)&&(value.original_id===null||value.original_id===originalId))onChanged();});},
    async fetchAny(profileId,originalId,requestId,onAttempt){
      uuid(requestId);const channel=new Channel<{index:number;total:number;device_id:string}>();
      channel.onmessage=value=>{if(Number.isSafeInteger(value.index)&&Number.isSafeInteger(value.total)&&value.index>0&&value.index<=value.total&&value.total<=256)onAttempt({index:value.index,total:value.total,deviceId:uuid(value.device_id)});};
      const raw=object(await call('beta_peer_original_fetch_any',{profileId,originalId,requestId,onAttempt:channel}),['original','verified','resumed_from','transferred_bytes']),original=validateOriginal(raw.original),resumed=integer(raw.resumed_from),transferred=integer(raw.transferred_bytes);
      if(original.original_id!==originalId||typeof raw.verified!=='boolean'||resumed>original.byte_length||transferred>original.byte_length-resumed)return invalid();return{original,verified:raw.verified,resumed_from:resumed,transferred_bytes:transferred};
    },
    async fetch(profileId,originalId,peerDeviceId,requestId){
      uuid(requestId);uuid(peerDeviceId);
      const raw=object(await call('beta_peer_original_fetch',{profileId,originalId,peerDeviceId,requestId}),['original','verified','resumed_from','transferred_bytes']);const original=validateOriginal(raw.original);
      const resumed=integer(raw.resumed_from);const transferred=integer(raw.transferred_bytes);
      if(original.original_id!==originalId||typeof raw.verified!=='boolean'||resumed>original.byte_length||transferred>original.byte_length-resumed)return invalid();
      return{original,verified:raw.verified,resumed_from:resumed,transferred_bytes:transferred};
    },
    async cancel(profileId,originalId,requestId){uuid(requestId);const result=await call('beta_peer_original_cancel',{profileId,originalId,requestId});if(typeof result!=='boolean')return invalid();return result;},
  };
}
export function originalAcquisitionError(value:unknown):string{
  const code=typeof value==='string'?value:value&&typeof value==='object'&&'code'in value?String(value.code):'';
  if(code==='peer_timeout')return'连接超时，请确认来源设备在线后重试；已收到的部分会保留';
  if(['tls_handshake_failed','peer_tls'].includes(code))return'连接握手失败，请检查网络与两端版本后重试；本机资料保持不变';
  if(['network_disabled','peer_network_disabled'].includes(code))return'设备同步已关闭，请先在同步页开启后重试；本机资料保持不变';
  if(['peer_busy','original_busy','attachment_busy'].includes(code))return'已有任务正在处理，请查看当前进度，或完成/取消后重试';
  if(['unreachable','peer_transport_unavailable','transport_unavailable'].includes(code))return'来源设备离线或连接中断，已收到的部分会保留，请连接后重试';
  if(['membership_denied','forbidden','unauthorized'].includes(code))return'未获得此来源设备的原件读取授权，请先在设备页确认授权';
  if(['original_hash_mismatch','original_integrity_mismatch'].includes(code))return'原件校验失败，未作为可用原件；请检查来源后重试';
  if(['original_not_ready','original_missing','unknown_original','not_found','no_original_source'].includes(code))return'尚未找到可用的原件副本，请让持有原件的已授权设备上线后重试';
  if(['cancelled','peer_cancelled','attachment_cancelled'].includes(code))return'获取已取消，已收到的部分会保留';
  if(['identity_mismatch','pin_mismatch','peer_pin_mismatch'].includes(code))return'来源设备身份与已确认授权不符；未放宽身份检查，请在同步页核对连接';
  if(['protocol_mismatch','incompatible'].includes(code))return'两端版本不兼容，请更新为同版应用后重试';
  return'原件获取尚未完成，请检查设备连接和授权后重试';
}
