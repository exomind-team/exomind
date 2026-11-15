import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaSettingsPage } from '@/beta/BetaSettingsPage';
import type { BetaDeadlineAlertStatus, BetaDeadlineAlertsClient } from '@/beta/deadline-alert-client';
import { deferred } from './fixtures';

const ready: BetaDeadlineAlertStatus = { platform_state: 'ready', notification_permission: 'denied', exact_alarm: false, pending_count: 2, scheduled_count: 0, delivered_count: 0, keepalive_requested: true, last_error_code: null };
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function fixture(initial: BetaDeadlineAlertStatus = ready) {
  const status = vi.fn(async () => initial);
  const requestPermission = vi.fn(async () => ({ state: 'granted' }));
  return { status, requestPermission } satisfies BetaDeadlineAlertsClient;
}
describe('Beta reminder qualification settings use Alpha rows', () => {
  it('never prompts on mount or read-only refresh, then requests only on an explicit single click and rereads qualifications', async () => {
    const client = fixture(); const permission = deferred<{ state: string }>(); client.requestPermission.mockReturnValueOnce(permission.promise);
    render(<BetaSettingsPage profileName="P" deadlineAlerts={client}/>);
    await screen.findByText('已读取系统提醒资格'); expect(client.status).toHaveBeenCalledTimes(1); expect(client.requestPermission).not.toHaveBeenCalled();
    expect(screen.getByTestId('beta-deadline-alert-settings').querySelector('[data-settings-section-card]')).toBeInTheDocument();
    expect(screen.getByText('已请求')).toBeInTheDocument(); expect(screen.queryByText('后台服务正在运行')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新提醒资格' })); await waitFor(() => expect(client.status).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '请求通知权限' })).toBeEnabled());
    expect(client.requestPermission).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: '请求通知权限' }); fireEvent.click(button); fireEvent.click(button);
    expect(client.requestPermission).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '刷新提醒资格' })).toBeDisabled();
    client.status.mockResolvedValue({ ...ready, notification_permission: 'granted', exact_alarm: true });
    await act(async () => { permission.resolve({ state: 'granted' }); });
    await screen.findByText('通知权限已允许'); await screen.findByText('具备'); expect(client.status).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('button', { name: '请求通知权限' })).not.toBeInTheDocument();
  });
  it('reports Web/unavailable without presenting reminder enablement or a permission button', async () => {
    const ui = render(<BetaSettingsPage profileName="P" deadlineAlerts={null}/>);
    expect(screen.getByText('当前环境不提供安卓系统提醒')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: '请求通知权限' })).not.toBeInTheDocument();
    const client = fixture({ ...ready, platform_state: 'unavailable', notification_permission: 'unavailable' });
    ui.rerender(<BetaSettingsPage profileName="P" deadlineAlerts={client}/>);
    await waitFor(() => expect(client.status).toHaveBeenCalledTimes(1)); await screen.findByText('当前环境不提供安卓系统提醒');
    expect(screen.queryByText('已请求')).not.toBeInTheDocument(); expect(screen.queryByText('具备')).not.toBeInTheDocument(); expect(client.requestPermission).not.toHaveBeenCalled();
  });
  it('serializes StrictMode reads and ignores an old transport response after replacement', async () => {
    const first = deferred<BetaDeadlineAlertStatus>(); const old = fixture(); old.status.mockReturnValueOnce(first.promise); const next = fixture({ ...ready, notification_permission: 'granted', pending_count: 7, keepalive_requested: false });
    const ui = render(<StrictMode><BetaSettingsPage profileName="P" deadlineAlerts={old}/></StrictMode>);
    await waitFor(() => expect(old.status).toHaveBeenCalledTimes(1));
    ui.rerender(<StrictMode><BetaSettingsPage profileName="P" deadlineAlerts={next}/></StrictMode>);
    expect(next.status).not.toHaveBeenCalled(); await act(async () => { first.resolve(ready); });
    await screen.findByText('未请求'); expect(next.status).toHaveBeenCalledTimes(1); expect(old.status).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已请求')).not.toBeInTheDocument(); expect(old.requestPermission).not.toHaveBeenCalled(); expect(next.requestPermission).not.toHaveBeenCalled();
  });
  it('shows bounded static failures and clears stale qualifications on an unreadable refresh', async () => {
    const client = fixture({ ...ready, platform_state: 'failed', last_error_code: 'deadline_alert_capacity' });
    render(<BetaSettingsPage profileName="P" deadlineAlerts={client}/>);
    await screen.findByText('系统提醒登记数量已达上限，部分提醒尚未登记');
    const section = within(screen.getByTestId('beta-deadline-alert-settings')); expect(section.queryByRole('button', { name: '请求通知权限' })).not.toBeInTheDocument();
    client.status.mockRejectedValueOnce({ code: 'native_private_error', message: 'synthetic-private-path-secret' });
    fireEvent.click(screen.getByRole('button', { name: '刷新提醒资格' }));
    await section.findByText('系统提醒状态尚未确认，请刷新后重试'); expect(section.queryByText('已请求')).not.toBeInTheDocument(); expect(screen.queryByText(/synthetic-private-path-secret/)).not.toBeInTheDocument();
  });
});
