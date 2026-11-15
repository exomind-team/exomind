import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BetaApiError } from './api-error';

export interface BetaDeadlineHandoff { handoff_id: string; profile_id: string; block_id: string; deadline_id: string }
export interface BetaDeadlineHandoffsClient {
  pending(): Promise<BetaDeadlineHandoff | null>;
  acknowledge(handoffId: string): Promise<boolean>;
  subscribe(changed: () => void): Promise<() => void>;
}
type Call = (command: string, args: Record<string, unknown>) => Promise<unknown>;
function invalid(): never { throw new BetaApiError('invalid_deadline_handoff', '通知入口尚未确认，请重试'); }
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) || value === '00000000-0000-0000-0000-000000000000') return invalid();
  return value;
}
export function sameDeadlineHandoff(a: BetaDeadlineHandoff | null, b: BetaDeadlineHandoff): boolean {
  return !!a && a.handoff_id === b.handoff_id && a.profile_id === b.profile_id && a.block_id === b.block_id && a.deadline_id === b.deadline_id;
}
export function nativeBetaDeadlineHandoffsClient(call: Call = (command, args) => invoke(command, args), subscribe: BetaDeadlineHandoffsClient['subscribe'] = changed => listen('beta-deadline-handoff', () => changed())): BetaDeadlineHandoffsClient {
  return {
    async pending() {
      const value = await call('beta_deadline_handoff_pending', {});
      if (value === null) return null;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
      const raw = value as Record<string, unknown>; const keys = ['handoff_id', 'profile_id', 'block_id', 'deadline_id'];
      if (Object.keys(raw).some(key => !keys.includes(key)) || keys.some(key => !(key in raw))) return invalid();
      return { handoff_id: uuid(raw.handoff_id), profile_id: uuid(raw.profile_id), block_id: uuid(raw.block_id), deadline_id: uuid(raw.deadline_id) };
    },
    async acknowledge(handoffId) { uuid(handoffId); const value = await call('beta_deadline_handoff_ack', { handoffId }); if (typeof value !== 'boolean') return invalid(); return value; },
    subscribe,
  };
}
