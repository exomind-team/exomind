import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';
import { createBetaSettingsRegistry, type BetaSettingsBindings } from '@/beta/settings-registry';
import { getBetaOverlayEnabled, openBetaOverlayForProfile, setBetaOverlayEnabled } from '@/beta/preferences';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const PROFILE = '11111111-1111-4111-8111-111111111111';
const SECOND_PROFILE = '22222222-2222-4222-8222-222222222222';
const syntheticScope = (profileId: string) => ({
  device_id: '33333333-3333-4333-8333-333333333333',
  runtime_id: '44444444-4444-4444-8444-444444444444',
  profile_id: profileId,
  ui_owner_generation: '55555555-5555-4555-8555-555555555555',
});

function settingsBindings(): BetaSettingsBindings {
  return {
    nativeDesktop: true,
    android: false,
    desktopLoading: false,
    desktopError: '',
    profileName: 'Synthetic profile',
    profileId: PROFILE,
    appVersion: 'test',
    buildHash: 'test',
    fullscreen: { get: () => false, set: async () => false },
    refreshDesktop: async () => {},
  };
}

const settingsContext = {} as SettingsContext;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

describe('Beta floating workspace entry', () => {
  it('displays the native failure code and message when enabling fails', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(syntheticScope(PROFILE) as never)
      .mockRejectedValueOnce({ code: 'overlay_not_ready', message: '合成工作区尚未就绪' });
    const setting = createBetaSettingsRegistry(settingsBindings()).find(
      item => item.type === 'boolean' && item.controlTestId === 'new-settings-now-overlay-enabled-switch',
    );
    expect(setting).toBeDefined();
    render(<SettingsItemRenderer item={setting!} ctx={settingsContext} />);

    fireEvent.click(screen.getByTestId('new-settings-now-overlay-enabled-switch'));

    const failure = await screen.findByText(/悬浮工作台未能应用：设置开关未应用（overlay_not_ready：合成工作区尚未就绪）/);
    expect(failure).toBeVisible();
    expect(failure).not.toHaveTextContent('[object Object]');
    expect(failure).toHaveTextContent('已确认的设置保持不变');
    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it('retains the last confirmed enabled setting when hiding fails', async () => {
    localStorage.setItem('exomind:beta:overlay-enabled', 'true');
    vi.mocked(invoke).mockRejectedValueOnce({
      code: 'overlay_window_hide_failed',
      message: '合成系统窗口没有隐藏',
    });
    const setting = createBetaSettingsRegistry(settingsBindings()).find(
      item => item.type === 'boolean' && item.controlTestId === 'new-settings-now-overlay-enabled-switch',
    );
    expect(setting).toBeDefined();
    render(<SettingsItemRenderer item={setting!} ctx={settingsContext} />);

    fireEvent.click(screen.getByTestId('new-settings-now-overlay-enabled-switch'));

    const failure = await screen.findByText(/设置开关未应用.*已确认的设置保持不变/);
    expect(failure).toBeVisible();
    expect(invoke).toHaveBeenCalledWith('beta_overlay_window', { operation: { kind: 'hide' } });
    expect(screen.getByTestId('new-settings-now-overlay-enabled-switch')).toHaveAttribute('aria-checked', 'true');
    expect(getBetaOverlayEnabled()).toBe(true);
  });

  it('binds the settings selected profile before enabling the floating workspace', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => command === 'beta_workspace_bind'
      ? syntheticScope(args?.profileId as string) as never
      : undefined as never);
    const setting = createBetaSettingsRegistry(settingsBindings()).find(
      item => item.type === 'boolean' && item.controlTestId === 'new-settings-now-overlay-enabled-switch',
    );
    render(<SettingsItemRenderer item={setting!} ctx={settingsContext} />);

    fireEvent.click(screen.getByTestId('new-settings-now-overlay-enabled-switch'));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenNthCalledWith(1, 'beta_workspace_bind', { profileId: PROFILE });
    expect(invoke).toHaveBeenNthCalledWith(2, 'beta_overlay_window', { operation: { kind: 'show' } });
    expect(getBetaOverlayEnabled()).toBe(true);
  });

  it('keeps the setting disabled and the window hidden when profile binding fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({
      code: 'profile_not_found',
      message: '合成档案不存在，请刷新档案列表后重选',
    });
    const setting = createBetaSettingsRegistry(settingsBindings()).find(
      item => item.type === 'boolean' && item.controlTestId === 'new-settings-now-overlay-enabled-switch',
    );
    render(<SettingsItemRenderer item={setting!} ctx={settingsContext} />);

    fireEvent.click(screen.getByTestId('new-settings-now-overlay-enabled-switch'));

    const failure = await screen.findByText(/悬浮工作台未能应用：设置开关未应用：档案绑定未完成（profile_not_found：合成档案不存在，请刷新档案列表后重选）/);
    expect(failure).toBeVisible();
    expect(failure).not.toHaveTextContent('[object Object]');
    expect(failure).toHaveTextContent('浮窗尚未打开');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('beta_workspace_bind', { profileId: PROFILE });
    expect(screen.getByTestId('new-settings-now-overlay-enabled-switch')).toHaveAttribute('aria-checked', 'false');
    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it('does not enable a floating workspace when settings have no selected profile', async () => {
    const bindings = settingsBindings();
    bindings.profileId = '';
    const setting = createBetaSettingsRegistry(bindings).find(
      item => item.type === 'boolean' && item.controlTestId === 'new-settings-now-overlay-enabled-switch',
    );
    render(<SettingsItemRenderer item={setting!} ctx={settingsContext} />);

    fireEvent.click(screen.getByTestId('new-settings-now-overlay-enabled-switch'));

    expect(await screen.findByText(/请先选择一个档案，再打开悬浮工作台/)).toBeVisible();
    expect(invoke).not.toHaveBeenCalled();
    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it('binds the selected synthetic profile before showing the floating window', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(syntheticScope(PROFILE) as never).mockResolvedValueOnce(undefined as never);

    await openBetaOverlayForProfile(PROFILE);

    expect(invoke).toHaveBeenNthCalledWith(1, 'beta_workspace_bind', { profileId: PROFILE });
    expect(invoke).toHaveBeenNthCalledWith(2, 'beta_overlay_window', { operation: { kind: 'show' } });
    expect(getBetaOverlayEnabled()).toBe(true);
  });

  it('does not show a window unless Native confirms the requested profile and runtime scope', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...syntheticScope(SECOND_PROFILE),
      runtime_id: '',
    } as never);

    await expect(openBetaOverlayForProfile(PROFILE)).rejects.toThrow(/档案绑定未完成.*未确认所选档案与运行实例的绑定/);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('beta_workspace_bind', { profileId: PROFILE });
    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it.each([
    ['unknown', { code: 'profile_not_found', message: '合成档案不存在，请刷新档案列表后重选' }],
    ['not ready', { code: 'overlay_not_ready', message: '合成本机工作区尚未就绪，请重新连接' }],
  ])('keeps the floating window hidden when the %s profile cannot bind', async (_case, failure) => {
    vi.mocked(invoke).mockRejectedValueOnce(failure);

    await expect(openBetaOverlayForProfile(PROFILE)).rejects.toThrow(/档案绑定未完成.*(profile_not_found|overlay_not_ready)/);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('beta_workspace_bind', { profileId: PROFILE });
    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it('offers a desktop recovery route when the platform rejects floating windows', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({
      code: 'overlay_unsupported',
      message: '当前平台尚未提供独立桌面浮窗',
    });

    await expect(setBetaOverlayEnabled(true)).rejects.toThrow(/当前平台不支持独立浮窗.*请继续在主界面使用/);

    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it('distinguishes a bound profile from a window that failed to appear', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(syntheticScope(PROFILE) as never)
      .mockRejectedValueOnce({ code: 'overlay_window_creation_failed', message: '系统拒绝创建合成窗口' });

    await expect(openBetaOverlayForProfile(PROFILE)).rejects.toThrow(/档案已绑定，但浮窗显示未确认.*overlay_window_creation_failed：系统拒绝创建合成窗口.*重试打开当前档案/);

    expect(invoke).toHaveBeenNthCalledWith(1, 'beta_workspace_bind', { profileId: PROFILE });
    expect(invoke).toHaveBeenNthCalledWith(2, 'beta_overlay_window', { operation: { kind: 'show' } });
    expect(getBetaOverlayEnabled()).toBe(false);
  });

  it('serializes each profile bind together with its show request', async () => {
    let releaseFirstBind!: () => void;
    const firstBind = new Promise<void>(resolve => { releaseFirstBind = resolve; });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'beta_workspace_bind' && args?.profileId === PROFILE) await firstBind;
      return command === 'beta_workspace_bind'
        ? syntheticScope(args?.profileId as string) as never
        : undefined as never;
    });

    const first = openBetaOverlayForProfile(PROFILE);
    const second = openBetaOverlayForProfile(SECOND_PROFILE);
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenNthCalledWith(1, 'beta_workspace_bind', { profileId: PROFILE });

    releaseFirstBind();
    await Promise.all([first, second]);

    expect(invoke.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['beta_workspace_bind', { profileId: PROFILE }],
      ['beta_overlay_window', { operation: { kind: 'show' } }],
      ['beta_workspace_bind', { profileId: SECOND_PROFILE }],
      ['beta_overlay_window', { operation: { kind: 'show' } }],
    ]);
  });

  it('allows repeated show requests to reach the native idempotent window owner', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined as never);

    await setBetaOverlayEnabled(true);
    await setBetaOverlayEnabled(true);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'beta_overlay_window', { operation: { kind: 'show' } });
    expect(invoke).toHaveBeenNthCalledWith(2, 'beta_overlay_window', { operation: { kind: 'show' } });
    expect(getBetaOverlayEnabled()).toBe(true);
  });
});
