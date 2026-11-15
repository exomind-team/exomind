import { describe, expect, it, vi } from 'vitest';
import { deadlineAlertFailure, deadlineNotificationPermission, nativeBetaDeadlineAlertsClient } from '@/beta/deadline-alert-client';

const ready = { platform_state: 'ready', notification_permission: 'denied', exact_alarm: false, pending_count: 2, scheduled_count: 0, delivered_count: 0, keepalive_requested: true, last_error_code: null };
describe('Beta deadline-alert Native boundary', () => {
  it('reads exact status fields and requests permission only through the explicit separate method', async () => {
    const call = vi.fn(async (command: string) => command === 'beta_deadline_alert_status' ? ready : { state: 'granted' });
    const client = nativeBetaDeadlineAlertsClient(call);
    expect(await client.status()).toEqual(ready); expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenLastCalledWith('beta_deadline_alert_status', {});
    expect(await client.requestPermission()).toEqual({ state: 'granted' });
    expect(call).toHaveBeenLastCalledWith('beta_deadline_alert_request_permission', {});
  });
  it('rejects malformed qualifications and counters instead of treating them as enabled', async () => {
    for (const value of [null, { ...ready, platform_state: 'enabled' }, { ...ready, exact_alarm: 1 }, { ...ready, keepalive_requested: 'running' },
      { ...ready, pending_count: -1 }, { ...ready, scheduled_count: 1.5 }, { ...ready, delivered_count: Number.MAX_SAFE_INTEGER + 1 },
      { ...ready, notification_permission: '' }, { ...ready, notification_permission: 'x'.repeat(32) }, { ...ready, last_error_code: 'x'.repeat(65) }, { ...ready, native_path: 'synthetic-private-path' }]) {
      const client = nativeBetaDeadlineAlertsClient(async () => value);
      await expect(client.status()).rejects.toMatchObject({ code: 'invalid_deadline_alert_response' });
    }
    for (const value of [{ state: true }, { state: 'x'.repeat(32) }, { state: 'granted', path: 'synthetic-private-path' }]) {
      await expect(nativeBetaDeadlineAlertsClient(async () => value).requestPermission()).rejects.toMatchObject({ code: 'invalid_deadline_alert_response' });
    }
  });
  it('maps known failures to static copy and never discloses arbitrary native text', () => {
    expect(deadlineAlertFailure('deadline_alert_capacity')).toContain('上限');
    expect(deadlineAlertFailure('deadline_alert_timeout')).toContain('尚未确认');
    expect(deadlineAlertFailure('synthetic/private/path')).toBe(deadlineAlertFailure(null));
    expect(deadlineNotificationPermission('granted')).toBe('已允许');
    expect(deadlineNotificationPermission('synthetic/private/path')).toBe('尚未确认');
  });
});
