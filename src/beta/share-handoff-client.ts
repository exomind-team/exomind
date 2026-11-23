import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { sha256 } from '@noble/hashes/sha2.js';
import { BetaApiError } from './api-error';

export type BetaShareHandoffState = 'receiving' | 'ready' | 'interrupted' | 'cancelled' | 'acknowledged';
export type BetaShareHandoffItemState = 'receiving' | 'ready' | 'interrupted' | 'cancelled' | 'acknowledged';
export type BetaShareHandoffTextState = 'none' | 'receiving' | 'ready' | 'interrupted' | 'cancelled' | 'acknowledged';
export type BetaShareHandoffErrorCode = 'interrupted' | 'content_unavailable' | 'permission_unavailable' | 'storage_unavailable' | 'size_mismatch' | 'cancelled' | 'quota_exceeded';

export interface BetaShareHandoffListItem {
  item_id: string;
  name: string;
  media_type: string;
  byte_length: number;
  state: BetaShareHandoffItemState;
  error_code: BetaShareHandoffErrorCode | null;
  recovery_instruction: string | null;
}

export interface BetaShareHandoffItem extends BetaShareHandoffListItem {
  sha256: string | null;
}

export interface BetaShareHandoffSummary {
  handoff_id: string;
  received_at_ms: number;
  state: BetaShareHandoffState;
  bound_profile_id: string | null;
  /** False means Native deliberately redacted all content for another profile. */
  profile_match: boolean;
  error_code: BetaShareHandoffErrorCode | null;
  recovery_instruction: string | null;
  text_state: BetaShareHandoffTextState;
  text_preview: string | null;
  items: BetaShareHandoffListItem[];
}

export interface BetaShareHandoff {
  handoff_id: string;
  received_at_ms: number;
  state: BetaShareHandoffState;
  bound_profile_id: string | null;
  error_code: BetaShareHandoffErrorCode | null;
  recovery_instruction: string | null;
  text_state: BetaShareHandoffTextState;
  text: string | null;
  items: BetaShareHandoffItem[];
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;
export interface BetaShareHandoffsClient {
  list(profileId?: string): Promise<BetaShareHandoffSummary[]>;
  get(handoffId: string, profileId?: string): Promise<BetaShareHandoff | null>;
  bindProfile(handoffId: string, profileId: string): Promise<void>;
  acknowledgeText(handoffId: string, profileId: string): Promise<void>;
  acknowledgeItem(handoffId: string, itemId: string, profileId: string): Promise<void>;
  discard(handoffId: string, profileId?: string): Promise<void>;
  cancel(handoffId: string): Promise<{ cancel_requested: boolean; status: BetaShareHandoffState }>;
  onAvailable(handler: (handoffId: string) => void): Promise<() => void>;
}

const invalid = () => new BetaApiError('invalid_share_handoff', '系统分享状态无效；原分享仍保留，请重试');
const safeToken = (value: unknown, max = 128): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f\s]/.test(value);
function record(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !allowed.includes(key)) || required.some(key => !(key in item))) throw invalid();
  return item;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && new TextEncoder().encode(value).byteLength <= max;
}
const handoffStates = ['receiving','ready','interrupted','cancelled','acknowledged'] as const;
const itemStates = ['receiving','ready','interrupted','cancelled','acknowledged'] as const;
const textStates = ['none','receiving','ready','interrupted','cancelled','acknowledged'] as const;
const errorCodes = ['interrupted','content_unavailable','permission_unavailable','storage_unavailable','size_mismatch','cancelled','quota_exceeded'] as const;
const MAX_SHARE_HANDOFF_LIST_ENTRIES=256;
const MAX_SHARE_HANDOFF_ITEMS=256;
function errorCode(value: unknown): BetaShareHandoffErrorCode | null {
  if (value === null) return null;
  if (typeof value === 'string' && (errorCodes as readonly string[]).includes(value)) return value as BetaShareHandoffErrorCode;
  throw invalid();
}
function recoveryInstruction(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.length <= 512 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return value;
  throw invalid();
}
function parseListItem(value: unknown): BetaShareHandoffListItem {
  const item = record(value, ['item_id','name','media_type','byte_length','state','error_code','recovery_instruction'],
    ['item_id','name','media_type','byte_length','state','error_code','recovery_instruction']);
  if (!safeToken(item.item_id) || !text(item.name, 1024) || item.name.length === 0
    || /[\\/\u0000-\u001f\u007f]/.test(item.name) || !text(item.media_type, 128)
    || !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/(?:[a-z0-9][a-z0-9!#$&^_.+-]{0,126}|\*)$/i.test(item.media_type)
    || !Number.isSafeInteger(item.byte_length) || (item.byte_length as number) < 0 || (item.byte_length as number) > 4 * 1024 * 1024 * 1024
    || !(itemStates as readonly unknown[]).includes(item.state)) throw invalid();
  return {
    item_id: item.item_id,
    name: item.name,
    media_type: item.media_type,
    byte_length: item.byte_length as number,
    state: item.state as BetaShareHandoffItemState,
    error_code: errorCode(item.error_code),
    recovery_instruction: recoveryInstruction(item.recovery_instruction),
  };
}
function parseDetailsItem(value: unknown): BetaShareHandoffItem {
  const row = record(value, ['item_id','name','media_type','byte_length','sha256','state','error_code','recovery_instruction'],
    ['item_id','name','media_type','byte_length','sha256','state','error_code','recovery_instruction']);
  if (row.sha256 !== null && (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256))) throw invalid();
  const listItem=parseListItem({
    item_id:row.item_id,name:row.name,media_type:row.media_type,byte_length:row.byte_length,
    state:row.state,error_code:row.error_code,recovery_instruction:row.recovery_instruction,
  });
  if(listItem.state==='ready'&&row.sha256===null)throw invalid();
  return { ...listItem, sha256: row.sha256 as string | null };
}
function parseHandoffIdentity(value: Record<string, unknown>): Pick<BetaShareHandoff,'handoff_id'|'received_at_ms'|'state'|'error_code'|'recovery_instruction'|'text_state'> {
  if (!safeToken(value.handoff_id) || !Number.isSafeInteger(value.received_at_ms) || (value.received_at_ms as number) < 0
    || !(handoffStates as readonly unknown[]).includes(value.state)
    || !(textStates as readonly unknown[]).includes(value.text_state)) throw invalid();
  return {
    handoff_id:value.handoff_id,
    received_at_ms:value.received_at_ms as number,
    state:value.state as BetaShareHandoffState,
    error_code:errorCode(value.error_code),
    recovery_instruction:recoveryInstruction(value.recovery_instruction),
    text_state:value.text_state as BetaShareHandoffTextState,
  };
}
function parseCommon(value: unknown): BetaShareHandoffSummary {
  const item = record(value,
    ['handoff_id','received_at_ms','state','bound_profile_id','profile_match','error_code','recovery_instruction','text_state','text_preview','items'],
    ['handoff_id','received_at_ms','state','bound_profile_id','profile_match','error_code','recovery_instruction','text_state','text_preview','items']);
  const identity=parseHandoffIdentity(item);
  if ((item.bound_profile_id !== null && !safeToken(item.bound_profile_id)) || typeof item.profile_match !== 'boolean'
    || (!item.profile_match && item.bound_profile_id === null)
    || (item.text_preview !== null && (!text(item.text_preview, 1024) || item.text_preview.length > 240))
    || !Array.isArray(item.items) || item.items.length > MAX_SHARE_HANDOFF_ITEMS) throw invalid();
  const items = item.items.map(parseListItem);
  if (new Set(items.map(file => file.item_id)).size !== items.length) throw invalid();
  if (!item.profile_match && (item.text_preview !== null || item.items.length !== 0 || item.text_state !== 'none')) throw invalid();
  return { ...identity, bound_profile_id:item.bound_profile_id as string|null, profile_match:item.profile_match,
    text_preview:item.text_preview as string|null, items };
}
export function parseBetaShareHandoff(value: unknown): BetaShareHandoff | null {
  if (value === null) return null;
  const item = record(value,
    ['handoff_id','received_at_ms','state','bound_profile_id','error_code','recovery_instruction','text','text_state','items'],
    ['handoff_id','received_at_ms','state','bound_profile_id','error_code','recovery_instruction','text','text_state','items']);
  const identity=parseHandoffIdentity(item);
  if ((item.bound_profile_id !== null && !safeToken(item.bound_profile_id)) || (item.text !== null && !text(item.text, 65_536))) throw invalid();
  if (!Array.isArray(item.items) || item.items.length > MAX_SHARE_HANDOFF_ITEMS) throw invalid();
  const items=item.items.map(parseDetailsItem);
  if(new Set(items.map(file=>file.item_id)).size!==items.length)throw invalid();
  return { ...identity, bound_profile_id:item.bound_profile_id as string|null, text:item.text as string|null, items };
}
export function parseBetaShareHandoffList(value: unknown): BetaShareHandoffSummary[] {
  if (!Array.isArray(value) || value.length > MAX_SHARE_HANDOFF_LIST_ENTRIES) throw invalid();
  const items = value.map(parseCommon);
  if (new Set(items.map(item => item.handoff_id)).size !== items.length) throw invalid();
  return items;
}

export function betaShareHandoffSourceId(handoffId: string, itemId: string): string {
  if (!safeToken(handoffId) || !safeToken(itemId)) throw invalid();
  const digest = sha256(new TextEncoder().encode(`exomind-beta-share\0${handoffId}\0${itemId}`));
  return `share-${Array.from(digest.subarray(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createBetaShareHandoffsClient(call: Invoke = invoke, subscribe: Listen = listen): BetaShareHandoffsClient {
  return {
    async list(profileId) {
      const value = profileId
        ? await call<unknown>('beta_share_handoff_list', { profile_id: profileId })
        : await call<unknown>('beta_share_handoff_list');
      return parseBetaShareHandoffList(value);
    },
    async get(handoffId, profileId) {
      if (!safeToken(handoffId)) throw invalid();
      const result = parseBetaShareHandoff(await call<unknown>('beta_share_handoff_get', {
        handoff_id: handoffId, ...(profileId ? { profile_id: profileId } : {}),
      }));
      if (result && result.handoff_id !== handoffId) throw invalid();
      return result;
    },
    async bindProfile(handoffId, profileId) {
      if (!safeToken(handoffId) || !safeToken(profileId)) throw invalid();
      const result = record(await call<unknown>('beta_share_handoff_bind_profile', { handoff_id: handoffId, profile_id: profileId }),
        ['bound_profile_id'], ['bound_profile_id']);
      if (result.bound_profile_id !== profileId) throw invalid();
    },
    async acknowledgeText(handoffId, profileId) {
      if (!safeToken(handoffId)) throw invalid();
      if (!safeToken(profileId)) throw invalid();
      const result=record(await call<unknown>('beta_share_handoff_ack_text', { handoff_id: handoffId, profile_id: profileId }),['acknowledged'],['acknowledged']);
      if(result.acknowledged!==true)throw new BetaApiError('share_handoff_ack_unconfirmed','系统分享文字仍待确认；原草稿已保留');
    },
    async acknowledgeItem(handoffId, itemId, profileId) {
      if (!safeToken(handoffId) || !safeToken(itemId) || !safeToken(profileId)) throw invalid();
      const result=record(await call<unknown>('beta_share_handoff_ack_item', { handoff_id: handoffId,item_id:itemId,profile_id:profileId }),['acknowledged'],['acknowledged']);
      if(result.acknowledged!==true)throw new BetaApiError('share_handoff_ack_unconfirmed','系统分享附件仍待确认；已验证的本机副本仍保留');
    },
    async discard(handoffId, profileId) {
      if (!safeToken(handoffId)) throw invalid();
      if (profileId !== undefined && !safeToken(profileId)) throw invalid();
      const result=record(await call<unknown>('beta_share_handoff_discard', { handoff_id: handoffId, ...(profileId ? { profile_id: profileId } : {}) }),['discarded'],['discarded']);
      if(result.discarded!==true)throw new BetaApiError('share_handoff_discard_unconfirmed','系统分享尚未清理确认；原内容仍保留');
    },
    async cancel(handoffId) {
      if (!safeToken(handoffId)) throw invalid();
      const value=record(await call<unknown>('beta_share_handoff_cancel', { handoff_id: handoffId }),['cancel_requested','status'],['cancel_requested','status']);
      if(typeof value.cancel_requested!=='boolean'||!(handoffStates as readonly unknown[]).includes(value.status))throw invalid();
      return {cancel_requested:value.cancel_requested,status:value.status as BetaShareHandoffState};
    },
    async onAvailable(handler) {
      return subscribe<{ handoff_id: string }>('beta-share-handoff-available', event => {
        if (event.payload && safeToken(event.payload.handoff_id)) handler(event.payload.handoff_id);
      });
    },
  };
}

export const nativeBetaShareHandoffsClient = (): BetaShareHandoffsClient => createBetaShareHandoffsClient();
