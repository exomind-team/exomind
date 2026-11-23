import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';

export type BetaEnvironmentAliasSource = 'custom' | 'os_default' | 'stable_id';
export type BetaAliasVerification = 'none' | 'signed' | 'confirmed';
export interface BetaEnvironmentAlias {
  device_id: string;
  effective_alias: string;
  source: BetaEnvironmentAliasSource;
  custom_alias: string | null;
  max_chars: number;
}
export interface BetaPeer {
  device_id: string;
  fingerprint_sha256: string;
  effective_alias: string;
  alias_source: BetaEnvironmentAliasSource;
  alias_verification: BetaAliasVerification;
  alias_confirmed_at_ms: number | null;
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
export interface BetaNearbyCandidate {
  device_id: string;
  fingerprint_sha256: string;
  effective_alias: string;
  alias_source: BetaEnvironmentAliasSource;
  alias_verification: BetaAliasVerification;
  alias_confirmed_at_ms: number | null;
  addresses: string[];
  expires_at_ms: number;
  verification_state: 'unverified';
}
export type BetaScanScopeKind = 'physical_lan' | 'easytier' | 'overlay' | 'other' | 'manual';
export interface BetaScanScope {
  scope_id: string;
  interface_name: string;
  kind: BetaScanScopeKind;
  prefix: number;
  eligible: boolean;
  network: string;
  reason: string | null;
}
export interface BetaNetworkScan {
  scan_id: string;
  started_at_ms: number;
  finished_at_ms: number;
  stage: 'tcp_probe' | 'complete' | 'cancelled' | 'cancelling';
  scopes: BetaScanScope[];
  attempted: number;
  discovered: number;
  skipped: number;
  cancelled: boolean;
  discovered_addresses: string[];
  peer_transport_count: number;
  peer_transport_candidates: BetaPeerTransportScanCandidate[];
}
export interface BetaPeerTransportScanCandidate {
  address: string;
  fingerprint_sha256: string;
  service_version: 'v1' | 'v2';
}
export interface BetaInvitation {
  invitation_text: string; invitation_id: string; expires_at_ms: number; local_addresses: string[];
}
export interface BetaInvitationEndpointReport {
  endpoint: string;
  disposition: 'attempted'|'skipped'|'reachable'|'identity_mismatch'|'unreachable'|'protocol_mismatch';
  elapsed_ms: number;
  error_code: string | null;
}
export interface BetaInvitationPreview {
  profile_id: string; profile_name: string; issuer_device_id: string;
  fingerprint_sha256: string; expires_at_ms: number; compatible: boolean;
  endpoints: BetaInvitationEndpointReport[];
  requires_replacement?: boolean;
}
export interface BetaJoinResult { profile_id: string; peer_device_id: string; state: 'pending' | 'ready' }
export class BetaPeerJoinError extends BetaApiError {
  constructor(code: string, message: string, public readonly endpoints: BetaInvitationEndpointReport[]) {
    super(code, message);
    this.name = 'BetaPeerJoinError';
  }
}
export interface BetaPeersClient {
  nearbyCandidates(): Promise<BetaNearbyCandidate[]>;
  networkEnabled(): Promise<boolean>;
  environmentAlias(): Promise<BetaEnvironmentAlias>;
  setEnvironmentAlias(alias: string | null): Promise<BetaEnvironmentAlias>;
  scanScopes(): Promise<BetaScanScope[]>;
  scanNearby(options: { scopeIds: string[]; manualCidrs?: string[] }): Promise<BetaNetworkScan>;
  scanStatus(scanId: string): Promise<BetaNetworkScan>;
  cancelScan(scanId: string): Promise<BetaNetworkScan>;
  status(profileId: string): Promise<BetaPeerStatus>;
  setEnabled(enabled: boolean): Promise<void>;
  createInvitation(profileId: string, peerDeviceId?: string): Promise<BetaInvitation>;
  inspectInvitation(invitationText: string): Promise<BetaInvitationPreview>;
  joinInvitation(invitationText: string, dialAddress?: string): Promise<BetaJoinResult>;
  sync(profileId: string, peerDeviceId: string): Promise<void>;
  revoke(profileId: string, peerDeviceId: string, expectedGeneration: number): Promise<void>;
}
type Call = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const invalid = (): never => { throw new BetaApiError('invalid_peer_response', '设备同步响应无效，请查证后重试'); };
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  const allowed = new Set([...keys, ...optional]);
  if (Object.keys(item).some(key => !allowed.has(key)) || keys.some(key => !(key in item))) return invalid();
  return item;
}
function text(value: unknown, max = 4096): string { if (typeof value !== 'string' || value.length > max) return invalid(); return value; }
function uuid(value: unknown): string {
  const id = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || id === '00000000-0000-0000-0000-000000000000') return invalid();
  return id;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return invalid(); return Number(value); }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function hash(value: unknown): string { const result = text(value, 64); if (!/^[0-9a-f]{64}$/.test(result)) return invalid(); return result; }
function strings(value: unknown): string[] { if (!Array.isArray(value) || value.length > 16) return invalid(); return value.map(value => text(value, 256)); }
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (!values.includes(value as T)) return invalid(); return value as T; }
const ALIAS_SOURCES=['custom','os_default','stable_id'] as const;
const ALIAS_VERIFICATIONS=['none','signed','confirmed'] as const;
function aliasText(value: unknown, input=false): string {
  const alias=text(value,input?1024:256);
  const normalized=alias.trim();
  if(!normalized||Array.from(normalized).length>64||new TextEncoder().encode(normalized).length>256)return invalid();
  if(input?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(alias):/[\u0000-\u001f\u007f]/.test(alias)||alias!==normalized)return invalid();
  return input?alias:normalized;
}
function aliasVerificationState(item:Record<string,unknown>): Pick<BetaPeer,'alias_verification'|'alias_confirmed_at_ms'> {
  const alias_verification=choice(item.alias_verification,ALIAS_VERIFICATIONS);
  const alias_confirmed_at_ms=item.alias_confirmed_at_ms===null?null:integer(item.alias_confirmed_at_ms,1);
  if((alias_verification==='confirmed')!==(alias_confirmed_at_ms!==null))return invalid();
  return {alias_verification,alias_confirmed_at_ms};
}
function environmentAliasView(value: unknown): BetaEnvironmentAlias {
  const item=object(value,['device_id','effective_alias','source','custom_alias','max_chars']);
  const source=choice(item.source,ALIAS_SOURCES);
  const effective_alias=aliasText(item.effective_alias);
  const custom_alias=item.custom_alias===null?null:aliasText(item.custom_alias);
  if((source==='custom')!==(custom_alias!==null)||(custom_alias!==null&&custom_alias!==effective_alias)||integer(item.max_chars,1,256)!==64)return invalid();
  return {device_id:uuid(item.device_id),effective_alias,source,custom_alias,max_chars:64};
}
function nearbyCandidate(value: unknown): BetaNearbyCandidate {
  const item = object(value, ['device_id','fingerprint_sha256','effective_alias','alias_source','alias_verification','alias_confirmed_at_ms','addresses','expires_at_ms','verification_state']);
  if (!Array.isArray(item.addresses) || item.addresses.length < 1 || item.addresses.length > 4) return invalid();
  const addresses = item.addresses.map(value => {
    const address = text(value, 128);
    if (!address || address.trim() !== address || /[\u0000-\u001f\u007f]/.test(address)) return invalid();
    return address;
  });
  if (new Set(addresses).size !== addresses.length) return invalid();
  const alias_source=choice(item.alias_source,ALIAS_SOURCES);
  const aliasState=aliasVerificationState(item);
  if(aliasState.alias_verification==='none'&&alias_source!=='stable_id')return invalid();
  return {
    device_id:uuid(item.device_id),
    fingerprint_sha256:hash(item.fingerprint_sha256),
    effective_alias:aliasText(item.effective_alias),
    alias_source,
    ...aliasState,
    addresses,
    expires_at_ms:integer(item.expires_at_ms, 1),
    verification_state:choice(item.verification_state,['unverified']),
  };
}
const SCAN_SCOPE_KINDS=['physical_lan','easytier','overlay','other','manual'] as const;
const MAX_SCAN_SCOPES=8;
const MAX_SCAN_DISCOVERED_ADDRESSES=64;
const SCAN_STAGES=['tcp_probe','complete','cancelled','cancelling'] as const;
function scanCidr(value: unknown): string {
  const cidr=text(value,64);
  if(!cidr)return cidr;
  const match=/^([0-9]{1,3}(?:\.[0-9]{1,3}){3})\/([0-9]{1,2})$/.exec(cidr);
  if(!match)return invalid();
  const octets=match[1].split('.');
  if(octets.some(octet=>!/^\d{1,3}$/.test(octet)||Number(octet)>255))return invalid();
  if(Number(match[2])>32)return invalid();
  return cidr;
}
function scanReason(value: unknown): string | null {
  if(value===null)return null;
  const code=text(value,64);
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(code))return invalid();
  return code;
}
function scopeId(value: unknown): string {
  const id=text(value,96);
  if(!id||id.trim()!==id||/[\u0000-\u001f\u007f]/.test(id)||/\s/.test(id))return invalid();
  return id;
}
function scanScope(value: unknown): BetaScanScope {
  const item=object(value,['scope_id','interface_name','kind','prefix','eligible','network','reason']);
  const eligible=boolean(item.eligible);
  const network=scanCidr(item.network);
  if(eligible&&!network)return invalid();
  return {
    scope_id:scopeId(item.scope_id),
    interface_name:text(item.interface_name,256),
    kind:choice(item.kind,SCAN_SCOPE_KINDS),
    prefix:integer(item.prefix,0,32),
    eligible,
    network,
    reason:scanReason(item.reason),
  };
}
function networkScan(value: unknown): BetaNetworkScan {
  const item=object(value,['scan_id','started_at_ms','finished_at_ms','stage','scopes','attempted','discovered','skipped','cancelled','discovered_addresses'],['peer_transport_count','peer_transport_candidates']);
  if(!Array.isArray(item.scopes)||item.scopes.length>MAX_SCAN_SCOPES)return invalid();
  const scopes=item.scopes.map(scanScope);
  if(new Set(scopes.map(scope=>scope.scope_id)).size!==scopes.length)return invalid();
  if(!Array.isArray(item.discovered_addresses)||item.discovered_addresses.length>MAX_SCAN_DISCOVERED_ADDRESSES)return invalid();
  const discovered_addresses=item.discovered_addresses.map(endpointAddress);
  if(new Set(discovered_addresses).size!==discovered_addresses.length)return invalid();
  const rawPeerCandidates=item.peer_transport_candidates??[];
  if(!Array.isArray(rawPeerCandidates)||rawPeerCandidates.length>64)return invalid();
  const peer_transport_candidates=rawPeerCandidates.map(raw=>{
    const candidate=object(raw,['address','fingerprint_sha256','service_version']);
    const address=endpointAddress(candidate.address);
    const fingerprint_sha256=text(candidate.fingerprint_sha256,64);
    if(!/^[a-f0-9]{64}$/.test(fingerprint_sha256)||!discovered_addresses.includes(address))return invalid();
    return {address,fingerprint_sha256,service_version:choice(candidate.service_version,['v1','v2'] as const)};
  });
  if(new Set(peer_transport_candidates.map(candidate=>candidate.address)).size!==peer_transport_candidates.length)return invalid();
  const cancelled=boolean(item.cancelled);
  const finished=integer(item.finished_at_ms,0);
  const stage=choice(item.stage,SCAN_STAGES);
  if(finished===0){
    if(cancelled||stage==='complete')return invalid();
  }else if(stage!=='complete'&&stage!=='cancelled')return invalid();
  const attempted=integer(item.attempted,0,1024);
  const discovered=integer(item.discovered,0,1024);
  if(discovered>attempted)return invalid();
  const peer_transport_count=item.peer_transport_count===undefined?0:integer(item.peer_transport_count,0,discovered);
  if(peer_transport_count<peer_transport_candidates.length)return invalid();
  const skipped=integer(item.skipped,0);
  if(cancelled&&stage!=='cancelled')return invalid();
  return {
    scan_id:uuid(item.scan_id),
    started_at_ms:integer(item.started_at_ms,0),
    finished_at_ms:finished,
    stage,
    scopes,
    attempted,
    discovered,
    skipped,
    cancelled,
    discovered_addresses,
    peer_transport_count,
    peer_transport_candidates,
  };
}
const ENDPOINT_DISPOSITIONS=['attempted','skipped','reachable','identity_mismatch','unreachable','protocol_mismatch'] as const;
const MAX_INVITATION_ENDPOINTS=8;
function endpointAddress(value: unknown): string {
  const endpoint=text(value,128);
  if (!endpoint || endpoint.trim()!==endpoint || /[\u0000-\u001f\u007f]/.test(endpoint)) return invalid();
  const v6=/^\[([^\]]+)\]:(\d{1,5})$/.exec(endpoint);
  if(v6){
    try { new URL(`http://[${v6[1]}]/`); } catch { return invalid(); }
    const port=Number(v6[2]);
    if(port>65535) return invalid();
    return endpoint;
  }
  const v4=/^([^:]+):(\d{1,5})$/.exec(endpoint);
  if(!v4) return invalid();
  const octets=v4[1].split('.');
  if(octets.length!==4||octets.some(octet=>!/^\d{1,3}$/.test(octet)||Number(octet)>255)) return invalid();
  const port=Number(v4[2]);
  if(port>65535) return invalid();
  return endpoint;
}
function endpointReports(value: unknown): BetaInvitationEndpointReport[] {
  if (!Array.isArray(value) || value.length > MAX_INVITATION_ENDPOINTS) return invalid();
  const reports=value.map(endpointReport);
  if (new Set(reports.map(report=>report.endpoint)).size !== reports.length) return invalid();
  return reports;
}
function endpointReport(value: unknown): BetaInvitationEndpointReport {
  const item=object(value,['endpoint','disposition','elapsed_ms','error_code']);
  const endpoint=endpointAddress(item.endpoint);
  const disposition=choice(item.disposition,ENDPOINT_DISPOSITIONS);
  const errorCode=item.error_code===null?null:text(item.error_code,64);
  if (errorCode!==null && !/^[a-z][a-z0-9_]{0,63}$/.test(errorCode)) return invalid();
  if(disposition==='reachable'&&errorCode!==null) return invalid();
  if(disposition!=='reachable'&&disposition!=='attempted'&&errorCode===null) return invalid();
  return {
    endpoint,
    disposition,
    elapsed_ms:integer(item.elapsed_ms,0,3_600_000),
    error_code:errorCode,
  };
}
function joinFailure(value: unknown): unknown {
  if(!value||typeof value!=='object'||Array.isArray(value)||!('endpoints' in value)) return value;
  const failure=object(value,['code','message','endpoints']);
  return new BetaPeerJoinError(
    text(failure.code,64),
    text(failure.message,1024),
    endpointReports(failure.endpoints),
  );
}
export function joinFailureEndpointReports(value: unknown): BetaInvitationEndpointReport[] | null {
  if(!value||typeof value!=='object'||Array.isArray(value)||!('endpoints' in value)) return null;
  try { return endpointReports((value as { endpoints: unknown }).endpoints); }
  catch { return null; }
}
function peer(value: unknown): BetaPeer {
  const extra=!!value&&typeof value==='object'&&'history_gaps'in value;
  const item = object(value, ['device_id','fingerprint_sha256','effective_alias','alias_source','alias_verification','alias_confirmed_at_ms','member_generation','member_state','connection_state','endpoints','last_sync_at_ms','last_error_code','event_sync','originals_sync',...(extra?['history_gaps']:[])]);
  const gaps=item.history_gaps;if(gaps!==undefined&&(!Array.isArray(gaps)||gaps.length>256))return invalid();
  const alias_source=choice(item.alias_source,ALIAS_SOURCES);
  const aliasState=aliasVerificationState(item);
  if(aliasState.alias_verification==='none'&&alias_source!=='stable_id')return invalid();
  return { device_id:uuid(item.device_id),fingerprint_sha256:hash(item.fingerprint_sha256),effective_alias:aliasText(item.effective_alias),alias_source,...aliasState,member_generation:integer(item.member_generation,1),
    member_state:choice(item.member_state,['pending','ready','revoked']),connection_state:choice(item.connection_state,['idle','connecting','syncing','waiting','error']),
    endpoints:strings(item.endpoints),last_sync_at_ms:item.last_sync_at_ms===null?null:integer(item.last_sync_at_ms),last_error_code:item.last_error_code===null?null:text(item.last_error_code,128),
    event_sync:choice(item.event_sync,['pending','complete']),originals_sync:choice(item.originals_sync,['unknown','pending','complete']),...(extra?{history_gaps:(gaps as unknown[]).map(value=>{const gap=object(value,['direction','origin_device_id','materialized_seq','available_seq']),materialized=integer(gap.materialized_seq),available=gap.available_seq===null?null:integer(gap.available_seq);if(available!==null&&available>materialized)return invalid();return{direction:choice(gap.direction,['from_peer','to_peer']),origin_device_id:uuid(gap.origin_device_id),materialized_seq:materialized,available_seq:available};})}:{}) };
}
export function nativeBetaPeersClient(call: Call = (command, args) => invoke(command, args)): BetaPeersClient {
  return {
    async nearbyCandidates() {
      const value = await call('beta_peer_nearby_candidates');
      if (!Array.isArray(value) || value.length > 64) return invalid();
      const candidates = value.map(nearbyCandidate);
      if (new Set(candidates.map(candidate => `${candidate.device_id}:${candidate.fingerprint_sha256}`)).size !== candidates.length) return invalid();
      return candidates;
    },
    async networkEnabled() {
      return boolean(await call('beta_peer_network_enabled'));
    },
    async environmentAlias() {
      return environmentAliasView(await call('beta_peer_get_environment_alias'));
    },
    async setEnvironmentAlias(alias) {
      const value=alias===null?null:aliasText(alias,true);
      return environmentAliasView(await call('beta_peer_set_environment_alias',{alias:value}));
    },
    async scanScopes() {
      const value = await call('beta_peer_scan_scopes');
      if (!Array.isArray(value) || value.length > 64) return invalid();
      const scopes = value.map(scanScope);
      if (new Set(scopes.map(scope => scope.scope_id)).size !== scopes.length) return invalid();
      return scopes;
    },
    async scanNearby(options) {
      if (!options || !Array.isArray(options.scopeIds) || options.scopeIds.length > MAX_SCAN_SCOPES) return invalid();
      const scopeIds = options.scopeIds.map(scopeId);
      if (scopeIds.some(id => !id) || new Set(scopeIds).size !== scopeIds.length) return invalid();
      const manualCidrs = options.manualCidrs ?? [];
      if (!Array.isArray(manualCidrs) || manualCidrs.length > MAX_SCAN_SCOPES) return invalid();
      const cidrs = manualCidrs.map(scanCidr).filter(cidr => cidr !== '');
      if (cidrs.some(cidr => cidr === '')) return invalid();
      return networkScan(await call('beta_peer_scan_start', { scopeIds, manualCidrs: cidrs }));
    },
    async scanStatus(scanId) {
      uuid(scanId);
      return networkScan(await call('beta_peer_scan_status', { scanId }));
    },
    async cancelScan(scanId) {
      uuid(scanId);
      return networkScan(await call('beta_peer_scan_cancel', { scanId }));
    },
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
      const raw = object(value, ['profile_id','profile_name','issuer_device_id','fingerprint_sha256','expires_at_ms','compatible','endpoints', ...(extra ? ['requires_replacement'] : [])]);
      return { profile_id:uuid(raw.profile_id),profile_name:text(raw.profile_name,256),issuer_device_id:uuid(raw.issuer_device_id),fingerprint_sha256:hash(raw.fingerprint_sha256),expires_at_ms:integer(raw.expires_at_ms),compatible:boolean(raw.compatible),endpoints:endpointReports(raw.endpoints), ...(extra ? {requires_replacement:boolean(raw.requires_replacement)} : {}) };
    },
    async joinInvitation(invitationText, dialAddress) {
      let value: unknown;
      try { value = await call('beta_peer_join_invitation', { invitationText, ...(dialAddress?.trim() ? {dialAddress:dialAddress.trim()} : {}) }); }
      catch (failure) { throw joinFailure(failure); }
      const raw = object(value, ['profile_id','peer_device_id','state']);
      return { profile_id:uuid(raw.profile_id),peer_device_id:uuid(raw.peer_device_id),state:choice(raw.state,['pending','ready']) };
    },
    async sync(profileId, peerDeviceId) { await call('beta_peer_sync', { profileId, peerDeviceId }); },
    async revoke(profileId, peerDeviceId, expectedGeneration) { await call('beta_peer_revoke', { profileId, peerDeviceId, expectedGeneration }); },
  };
}
