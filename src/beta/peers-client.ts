import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';

export interface BetaPeer {
  device_id: string;
  fingerprint_sha256: string;
  member_generation: number;
  member_state: 'pending' | 'ready' | 'revoked';
  connection_state: 'idle' | 'connecting' | 'syncing' | 'waiting' | 'error';
  endpoints: string[];
  last_sync_at_ms: number | null;
  last_error_code: string | null;
  event_sync: 'pending' | 'complete';
  originals_sync: 'unknown' | 'pending' | 'complete';
  history_gaps?:Array<{direction:'from_peer'|'to_peer';origin_device_id:string;materialized_seq:number;available_seq:number|null}>;
}
export interface BetaPeerStatus {
  runtime_id: string; device_id: string; profile_id: string;
  network_enabled: boolean; local_addresses: string[]; peers: BetaPeer[];
}
export interface BetaInvitation {
  invitation_text: string; invitation_id: string; expires_at_ms: number; local_addresses: string[];
}
export interface BetaInvitationPreview {
  profile_id: string; profile_name: string; issuer_device_id: string;
  fingerprint_sha256: string; expires_at_ms: number; compatible: boolean;
  requires_replacement?: boolean;
}
export interface BetaJoinResult { profile_id: string; peer_device_id: string; state: 'pending' | 'ready' }
export interface BetaPeersClient {
  status(profileId: string): Promise<BetaPeerStatus>;
  setEnabled(enabled: boolean): Promise<void>;
  createInvitation(profileId: string, peerDeviceId?: string): Promise<BetaInvitation>;
  inspectInvitation(invitationText: string): Promise<BetaInvitationPreview>;
  joinInvitation(invitationText: string): Promise<BetaJoinResult>;
  sync(profileId: string, peerDeviceId: string): Promise<void>;
  revoke(profileId: string, peerDeviceId: string, expectedGeneration: number): Promise<void>;
}
type Call = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const invalid = (): never => { throw new BetaApiError('invalid_peer_response', '设备同步响应无效，请查证后重试'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key)) || keys.some(key => !(key in item))) return invalid();
  return item;
}
function text(value: unknown, max = 4096): string { if (typeof value !== 'string' || value.length > max) return invalid(); return value; }
function uuid(value: unknown): string {
  const id = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || id === '00000000-0000-0000-0000-000000000000') return invalid();
  return id;
}
function integer(value: unknown, min = 0): number { if (!Number.isSafeInteger(value) || Number(value) < min) return invalid(); return Number(value); }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function hash(value: unknown): string { const result = text(value, 64); if (!/^[0-9a-f]{64}$/.test(result)) return invalid(); return result; }
function strings(value: unknown): string[] { if (!Array.isArray(value) || value.length > 16) return invalid(); return value.map(value => text(value, 256)); }
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (!values.includes(value as T)) return invalid(); return value as T; }
function peer(value: unknown): BetaPeer {
  const extra=!!value&&typeof value==='object'&&'history_gaps'in value;
  const item = object(value, ['device_id','fingerprint_sha256','member_generation','member_state','connection_state','endpoints','last_sync_at_ms','last_error_code','event_sync','originals_sync',...(extra?['history_gaps']:[])]);
  const gaps=item.history_gaps;if(gaps!==undefined&&(!Array.isArray(gaps)||gaps.length>256))return invalid();
  return { device_id:uuid(item.device_id),fingerprint_sha256:hash(item.fingerprint_sha256),member_generation:integer(item.member_generation,1),
    member_state:choice(item.member_state,['pending','ready','revoked']),connection_state:choice(item.connection_state,['idle','connecting','syncing','waiting','error']),
    endpoints:strings(item.endpoints),last_sync_at_ms:item.last_sync_at_ms===null?null:integer(item.last_sync_at_ms),last_error_code:item.last_error_code===null?null:text(item.last_error_code,128),
    event_sync:choice(item.event_sync,['pending','complete']),originals_sync:choice(item.originals_sync,['unknown','pending','complete']),...(extra?{history_gaps:(gaps as unknown[]).map(value=>{const gap=object(value,['direction','origin_device_id','materialized_seq','available_seq']),materialized=integer(gap.materialized_seq),available=gap.available_seq===null?null:integer(gap.available_seq);if(available!==null&&available>materialized)return invalid();return{direction:choice(gap.direction,['from_peer','to_peer']),origin_device_id:uuid(gap.origin_device_id),materialized_seq:materialized,available_seq:available};})}:{}) };
}
export function nativeBetaPeersClient(call: Call = (command, args) => invoke(command, args)): BetaPeersClient {
  return {
    async status(profileId) {
      const raw = object(await call('beta_peer_status', { profileId }), ['runtime_id','device_id','profile_id','network_enabled','local_addresses','peers']);
      if (raw.profile_id !== profileId || !Array.isArray(raw.peers) || raw.peers.length > 256) return invalid();
      const peers = raw.peers.map(peer);
      if (new Set(peers.map(peer => peer.device_id)).size !== peers.length) return invalid();
      return { runtime_id:uuid(raw.runtime_id),device_id:uuid(raw.device_id),profile_id:uuid(raw.profile_id),network_enabled:boolean(raw.network_enabled),local_addresses:strings(raw.local_addresses),peers };
    },
    async setEnabled(enabled) { await call('beta_peer_set_enabled', { enabled }); },
    async createInvitation(profileId, peerDeviceId) {
      const raw = object(await call('beta_peer_create_invitation', { profileId, ...(peerDeviceId ? { peerDeviceId } : {}) }), ['invitation_text','invitation_id','expires_at_ms','local_addresses']);
      return { invitation_text:text(raw.invitation_text,32768),invitation_id:uuid(raw.invitation_id),expires_at_ms:integer(raw.expires_at_ms),local_addresses:strings(raw.local_addresses) };
    },
    async inspectInvitation(invitationText) {
      const value = await call('beta_peer_inspect_invitation', { invitationText });
      const extra = !!value && typeof value === 'object' && 'requires_replacement' in value;
      const raw = object(value, ['profile_id','profile_name','issuer_device_id','fingerprint_sha256','expires_at_ms','compatible', ...(extra ? ['requires_replacement'] : [])]);
      return { profile_id:uuid(raw.profile_id),profile_name:text(raw.profile_name,256),issuer_device_id:uuid(raw.issuer_device_id),fingerprint_sha256:hash(raw.fingerprint_sha256),expires_at_ms:integer(raw.expires_at_ms),compatible:boolean(raw.compatible), ...(extra ? {requires_replacement:boolean(raw.requires_replacement)} : {}) };
    },
    async joinInvitation(invitationText) {
      const raw = object(await call('beta_peer_join_invitation', { invitationText }), ['profile_id','peer_device_id','state']);
      return { profile_id:uuid(raw.profile_id),peer_device_id:uuid(raw.peer_device_id),state:choice(raw.state,['pending','ready']) };
    },
    async sync(profileId, peerDeviceId) { await call('beta_peer_sync', { profileId, peerDeviceId }); },
    async revoke(profileId, peerDeviceId, expectedGeneration) { await call('beta_peer_revoke', { profileId, peerDeviceId, expectedGeneration }); },
  };
}
