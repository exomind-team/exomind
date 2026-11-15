import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';

export interface BetaDeadlineAlertStatus {
  platform_state: 'unavailable' | 'ready' | 'failed';
  notification_permission: string;
  exact_alarm: boolean;
  pending_count: number;
  scheduled_count: number;
  delivered_count: number;
  keepalive_requested: boolean;
  last_error_code: string | null;
}
export interface BetaDeadlineAlertsClient {
  status(): Promise<BetaDeadlineAlertStatus>;
  requestPermission(): Promise<{ state: string }>;
}
type Call = (command: string, args: Record<string, unknown>) => Promise<unknown>;
function invalid(): never { throw new BetaApiError('invalid_deadline_alert_response', '系统提醒状态尚未确认，请刷新后重试'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !(key in result))) return invalid();
  return result;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.length || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid(); return Number(value); }
export function nativeBetaDeadlineAlertsClient(call: Call = (command, args) => invoke(command, args)): BetaDeadlineAlertsClient {
  return {
    async status() {
      const raw = object(await call('beta_deadline_alert_status', {}), ['platform_state', 'notification_permission', 'exact_alarm', 'pending_count', 'scheduled_count', 'delivered_count', 'keepalive_requested', 'last_error_code']);
      if (!['unavailable', 'ready', 'failed'].includes(String(raw.platform_state)) || typeof raw.exact_alarm !== 'boolean' || typeof raw.keepalive_requested !== 'boolean') return invalid();
      return { platform_state: raw.platform_state as BetaDeadlineAlertStatus['platform_state'], notification_permission: text(raw.notification_permission, 31),
        exact_alarm: raw.exact_alarm, pending_count: count(raw.pending_count), scheduled_count: count(raw.scheduled_count), delivered_count: count(raw.delivered_count),
        keepalive_requested: raw.keepalive_requested, last_error_code: raw.last_error_code === null ? null : text(raw.last_error_code, 64) };
    },
    async requestPermission() {
      const raw = object(await call('beta_deadline_alert_request_permission', {}), ['state']);
      return { state: text(raw.state, 31) };
    },
  };
}
/** Native codes select static copy only; native error bodies and paths never
 * enter settings text, logs or attributes. Unknown codes stay unconfirmed. */
export function deadlineAlertFailure(code: string | null): string {
  switch (code) {
    case 'deadline_alert_capacity': return '系统提醒登记数量已达上限，部分提醒尚未登记';
    case 'deadline_alert_unavailable': return '当前环境未提供系统提醒';
    case 'deadline_alert_platform_failed': return '系统提醒登记失败，请刷新资格后重试';
    case 'deadline_keepalive_unavailable': return '保活请求尚未获得确认，请刷新后检查';
    case 'deadline_alert_timeout': return '系统提醒回调尚未确认，请稍后刷新';
    default: return '系统提醒状态尚未确认，请刷新后重试';
  }
}
export function deadlineNotificationPermission(state: string): string {
  switch (state) {
    case 'granted': return '已允许';
    case 'denied': return '未允许';
    case 'prompt': return '等待系统确认';
    case 'unavailable': return '当前环境不可用';
    default: return '尚未确认';
  }
}
