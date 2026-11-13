import { invoke } from '@tauri-apps/api/core';
import type { BetaOriginal, BetaOriginalClient } from './original-types';
import { BetaApiError } from './api-error';
import { boundedOriginalBody, nativeOriginalClient, webOriginalClient, validateOriginal } from './original-client';
export { BetaApiError } from './api-error';

export interface BetaStatus { protocol: string; device_id: string; runtime_id?: string; running: boolean; capabilities?: { originals?: boolean; max_original_chunk_bytes?: number } }
export interface BetaProfile { profile_id: string; display_name: string }
export interface BetaCommand {
  command_id: string; event_id: string; profile_id: string;
  occurred_at_ms: number; text: string; tags: string[];
  originals?: BetaOriginal[];
}
export interface BetaReceipt {
  command_id: string; event_id: string; profile_id: string; local_seq: number;
  event_digest: string; durability: 'local_committed'; replayed: boolean;
}
export interface BetaEvent {
  event_id: string; profile_id: string; device_id: string; author_id: string;
  author_kind: 'human' | 'agent_note'; occurred_at_ms: number; text: string;
  tags: string[]; digest: string; local_seq: number;
  originals?: BetaOriginal[];
}
export interface BetaQuery { before?: number; through?: number; limit?: number; search?: string }
export interface BetaPage { items: BetaEvent[]; next_before: number | null; highwater: number }
export interface BetaClient {
  originals?: BetaOriginalClient;
  status(): Promise<BetaStatus>;
  profiles(): Promise<BetaProfile[]>;
  provisionProfile(profileId: string, name: string): Promise<BetaProfile>;
  capture(command: BetaCommand): Promise<BetaReceipt>;
  eventsPage(profileId: string, query: BetaQuery): Promise<BetaPage>;
  receipt(profileId: string, commandId: string): Promise<BetaReceipt | null>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BetaApiError('invalid_response', '服务返回了无法识别的数据');
  return value as Record<string, unknown>;
}
export function validateReceipt(value: unknown, command?: BetaCommand): BetaReceipt {
  const item = object(value);
  if (item.durability !== 'local_committed' || typeof item.command_id !== 'string' || typeof item.event_id !== 'string'
    || typeof item.profile_id !== 'string' || !Number.isSafeInteger(item.local_seq) || Number(item.local_seq) <= 0
    || typeof item.event_digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.event_digest)
    || typeof item.replayed !== 'boolean'
    || (command && (item.command_id !== command.command_id || item.event_id !== command.event_id || item.profile_id !== command.profile_id))) {
    throw new BetaApiError('invalid_receipt', '保存回执与本次记录不一致，正在等待查证');
  }
  return item as unknown as BetaReceipt;
}

function status(value: unknown): BetaStatus {
  const item = object(value);
  if (item.protocol !== 'exomind-beta/1' || typeof item.device_id !== 'string' || !item.device_id || item.running !== true) {
    throw new BetaApiError('incompatible_service', '服务版本不匹配或尚未就绪');
  }
  return item as unknown as BetaStatus;
}
function profile(value: unknown): BetaProfile {
  const item = object(value);
  if (typeof item.profile_id !== 'string' || !item.profile_id || typeof item.display_name !== 'string') throw new BetaApiError('invalid_response', '档案响应无效');
  return item as unknown as BetaProfile;
}
function profiles(value: unknown): BetaProfile[] {
  if (!Array.isArray(value)) throw new BetaApiError('invalid_response', '未能读取档案列表');
  return value.map(profile);
}
function page(value: unknown, profileId: string, query: BetaQuery): BetaPage {
  const item = object(value);
  if (!Array.isArray(item.items) || !Number.isSafeInteger(item.highwater) || Number(item.highwater) < 0
    || (query.through !== undefined && item.highwater !== query.through)) throw new BetaApiError('invalid_page', '历史快照不一致，请重新加载');
  let previous = query.before ?? Number.MAX_SAFE_INTEGER;
  for (const raw of item.items) {
    const event = object(raw);
    if (event.profile_id !== profileId || typeof event.event_id !== 'string' || typeof event.text !== 'string'
      || !Number.isSafeInteger(event.local_seq) || Number(event.local_seq) <= 0 || Number(event.local_seq) >= previous
      || Number(event.local_seq) > Number(item.highwater) || !Number.isSafeInteger(event.occurred_at_ms)
      || (event.author_kind !== 'human' && event.author_kind !== 'agent_note')) throw new BetaApiError('invalid_page', '历史页包含不一致的记录');
    if (event.originals !== undefined) {
      if (!Array.isArray(event.originals)) throw new BetaApiError('invalid_page','记录的原件清单无效');
      event.originals.forEach(validateOriginal);
    }
    previous = Number(event.local_seq);
  }
  if (item.items.length > (query.limit ?? 100) || (item.next_before !== null
    && (!item.items.length || item.next_before !== previous))) throw new BetaApiError('invalid_page', '历史游标无效');
  return item as unknown as BetaPage;
}

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
function identityGuard() {
  let device: string | undefined;
  let invalid = false;
  return (value: unknown): BetaStatus => {
    const current = status(value);
    if (invalid || (device && device !== current.device_id)) {
      invalid = true;
      throw new BetaApiError('identity_changed', '服务数据目录已变化，请重新连接；原草稿仍保留在原设备档案下');
    }
    device = current.device_id;
    return current;
  };
}
export function nativeBetaClient(call: NativeInvoke = invoke): BetaClient {
  const check = identityGuard();
  async function checked<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    check(await call('beta_status'));
    return call<T>(name, args);
  }
  return {
    originals: nativeOriginalClient(async <T>(name: string,args?:Record<string,unknown>) => {
      const current=check(await call('beta_status'));
      if(current.capabilities?.originals!==true) throw new BetaApiError('unsupported_originals','本机服务尚不支持原件，请更新后重试');
      return call<T>(name,args);
    }),
    async status() { return check(await call('beta_status')); },
    async profiles() { return profiles(await checked('beta_profiles')); },
    async provisionProfile(profileId, name) { return profile(await checked('beta_provision_profile', { profileId, name })); },
    async capture(command) { return validateReceipt(await checked('beta_capture', { command }), command); },
    async eventsPage(profileId, query) { return page(await checked('beta_events_page', { profileId, query }), profileId, query); },
    async receipt(profileId, commandId) {
      const value = await checked('beta_receipt', { profileId, commandId });
      return value === null ? null : validateReceipt(value);
    },
  };
}

/** Owner credentials stay in this browser session. They only manage grants;
 * selected-profile data requests use a distinct human grant, never owner. */
export function webBetaClient(endpoint: string, ownerToken: string, fetcher: typeof fetch = fetch): BetaClient {
  const target = new URL(endpoint, window.location.origin);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash
    || !['/', '/beta/v1', '/beta/v1/'].includes(target.pathname)) throw new BetaApiError('invalid_endpoint', '服务地址不能包含凭据、查询参数或其他路径');
  if (!ownerToken.trim()) throw new BetaApiError('missing_credential', '请粘贴本机服务的管理凭据');
  const base = `${target.origin}/beta/v1`;
  const grants = new Map<string, Promise<string>>();
  const check = identityGuard();
  let runtime: string | undefined;
  async function request(path: string, token: string | null, method = 'GET', body?: unknown, binaryBody = false, responseLimit?: number): Promise<unknown> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetcher(`${base}${path}`, {
        method, signal: abort.signal, redirect: 'error', credentials: 'omit',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': binaryBody ? 'application/octet-stream' : 'application/json' } : {}) },
        body: body === undefined ? undefined : binaryBody ? (body as Uint8Array).slice().buffer as ArrayBuffer : JSON.stringify(body),
      });
      if (response.ok && responseLimit !== undefined) return await boundedOriginalBody(response,responseLimit);
      const value: unknown = await response.json();
      if (!response.ok) {
        const error = object(object(value).error);
        throw new BetaApiError(typeof error.code === 'string' ? error.code : 'request_failed', typeof error.message === 'string' ? error.message : '服务请求失败', response.status);
      }
      return value;
    } finally { clearTimeout(timeout); }
  }
  async function hello(): Promise<BetaStatus> {
    const current = check(await request('/hello', null));
    if (runtime !== current.runtime_id) grants.clear();
    runtime = current.runtime_id;
    return current;
  }
  async function humanToken(profileId: string, originals = false): Promise<string> {
    const current=await hello();
    if(originals && current.capabilities?.originals!==true) throw new BetaApiError('unsupported_originals','本机服务尚不支持原件，请更新后重试');
    let grant = grants.get(profileId);
    if (!grant) {
      grant = request('/grants', ownerToken, 'POST', { profile_id: profileId, kind: 'human' }).then(value => {
        const item = object(value);
        if (item.profile_id !== profileId || item.kind !== 'human' || typeof item.token !== 'string' || !item.token) throw new BetaApiError('invalid_grant', '本机写入授权不匹配');
        return item.token;
      });
      grants.set(profileId, grant);
      void grant.catch(() => { if (grants.get(profileId) === grant) grants.delete(profileId); });
    }
    return grant;
  }
  return {
    originals: webOriginalClient({
      async json(profileId,path,method,body) { return request(path,await humanToken(profileId,true),method,body); },
      async binary(profileId,path,method,body,responseLimit) { return request(path,await humanToken(profileId,true),method,body,body!==undefined,responseLimit); },
    }),
    status: hello,
    async profiles() { await hello(); return profiles(await request('/profiles', ownerToken)); },
    async provisionProfile(profileId, name) { await hello(); return profile(await request(`/profiles/${encodeURIComponent(profileId)}`, ownerToken, 'PUT', { name })); },
    async capture(command) { return validateReceipt(await request('/capture', await humanToken(command.profile_id), 'POST', command), command); },
    async eventsPage(profileId, query) {
      const params = new URLSearchParams();
      for (const key of ['before', 'through', 'limit'] as const) if (query[key] !== undefined) params.set(key, String(query[key]));
      if (query.search !== undefined) params.set('q', query.search);
      return page(await request(`/profiles/${encodeURIComponent(profileId)}/events?${params}`, await humanToken(profileId)), profileId, query);
    },
    async receipt(profileId, commandId) {
      try { return validateReceipt(await request(`/profiles/${encodeURIComponent(profileId)}/receipts/${encodeURIComponent(commandId)}`, await humanToken(profileId))); }
      catch (error) { if (error instanceof BetaApiError && error.status === 404 && error.code === 'not_found') return null; throw error; }
    },
  };
}
