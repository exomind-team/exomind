import { describe, expect, it, vi } from 'vitest';
import type { ActiveBlockData } from '@/lib/types/event';
import type { TimeBlockService } from '@/lib/services/timeblock.service';
import {
  resolveNotificationActionFromPayload,
  resolveTimeBlockNotificationModel,
  TimeBlockNotificationServiceImpl,
} from '@/lib/services/timeblock-notification.service';

function createActiveBlock(overrides?: Partial<ActiveBlockData>): ActiveBlockData {
  return {
    startId: 'block-1',
    name: '深度工作',
    mode: 'countup',
    elapsed: 120000,
    startTime: 1700000000000,
    paused: false,
    ...overrides,
  };
}

describe('timeblock notification service issue-249（通知桥接服务）', () => {
  it('maps block state to notification model（时间块状态映射通知模型）', () => {
    const idle = resolveTimeBlockNotificationModel(null);
    expect(idle.mode).toBe('idle');
    expect(idle.actionTypeId).toContain('idle');

    const running = resolveTimeBlockNotificationModel(createActiveBlock({ paused: false }));
    expect(running.mode).toBe('running');
    expect(running.actionTypeId).toContain('running');

    const paused = resolveTimeBlockNotificationModel(createActiveBlock({ paused: true }));
    expect(paused.mode).toBe('paused');
    expect(paused.actionTypeId).toContain('paused');
  });

  it('parses action payload from notification callback（解析通知动作回调）', () => {
    expect(resolveNotificationActionFromPayload({
      actionId: 'pause',
      notification: { extra: { scope: 'timeblock' } },
    })).toBe('pause');

    expect(resolveNotificationActionFromPayload({
      actionId: 'tap',
      notification: { extra: { scope: 'timeblock' } },
    })).toBe('open');

    expect(resolveNotificationActionFromPayload({
      actionId: 'pause',
      notification: { extra: { scope: 'other' } },
    })).toBeNull();
  });

  it('starts bridge only on tauri android and dispatches actions（仅 tauri android 启动并派发动作）', async () => {
    let onBlockChangeCallback: ((block: ActiveBlockData | null) => void) | null = null;
    let onActionCallback: ((payload: unknown) => void) | null = null;

    const timeBlockService = {
      loadActiveBlock: vi.fn().mockResolvedValue(null),
      onBlockChange: vi.fn((cb: (block: ActiveBlockData | null) => void) => {
        onBlockChangeCallback = cb;
        return () => {
          onBlockChangeCallback = null;
        };
      }),
    } as unknown as TimeBlockService;

    const plugin = {
      isPermissionGranted: vi.fn().mockResolvedValue(true),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      registerActionTypes: vi.fn().mockResolvedValue(undefined),
      sendNotification: vi.fn(),
      onAction: vi.fn(async (cb: (payload: unknown) => void) => {
        onActionCallback = cb;
        return () => {
          onActionCallback = null;
        };
      }),
      removeActive: vi.fn().mockResolvedValue(undefined),
    };

    const dispatchAction = vi.fn();
    const service = new TimeBlockNotificationServiceImpl({
      timeBlockService,
      runtimeInfoProvider: async () => ({ isTauriRuntime: true, isAndroid: true }),
      notificationPluginLoader: async () => plugin,
      dispatchAction,
    });

    await service.setEnabled(true);

    expect(plugin.registerActionTypes).toHaveBeenCalledTimes(1);
    expect(plugin.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: '时间块 · 待开始',
      actionTypeId: expect.stringContaining('idle'),
    }));

    onBlockChangeCallback?.(createActiveBlock({ paused: true }));
    expect(plugin.sendNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '时间块已暂停',
      actionTypeId: expect.stringContaining('paused'),
    }));

    onActionCallback?.({
      actionId: 'resume',
      notification: { extra: { scope: 'timeblock' } },
    });
    expect(dispatchAction).toHaveBeenCalledWith('resume');

    await service.setEnabled(false);
    expect(plugin.removeActive).toHaveBeenCalledWith([249001]);
  });

  it('does not start when runtime is not tauri android（非 tauri android 不启动）', async () => {
    const pluginLoader = vi.fn();
    const timeBlockService = {
      loadActiveBlock: vi.fn().mockResolvedValue(null),
      onBlockChange: vi.fn(() => () => {}),
    } as unknown as TimeBlockService;
    const service = new TimeBlockNotificationServiceImpl({
      timeBlockService,
      runtimeInfoProvider: async () => ({ isTauriRuntime: false, isAndroid: true }),
      notificationPluginLoader: pluginLoader as never,
    });

    await service.setEnabled(true);
    expect(pluginLoader).not.toHaveBeenCalled();
  });
});
