import { invoke } from '@tauri-apps/api/core';
import { isDesktopOperatingSystem, isTauriWindow } from '@/config/runtime-target';
import type { TimeblockEndAlertRequest } from '@/lib/timeblock/end-alert-policy';

export interface TimeblockEndAlertSupport {
  supported: boolean;
  reason: string | null;
}

export interface PendingTimeblockEndHandoff {
  kind: 'timeblock-end-alert';
  startId: string | null;
  source: 'notification' | 'auto-open';
}

export type TimeblockEndAlertNotificationPermissionState =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unavailable';

let lastScheduleSignature: string | null = null;
let runtimeSyncKnown = false;
let applyQueue: Promise<void> = Promise.resolve();

function isAndroidTauriWindow(): boolean {
  if (!isTauriWindow() || typeof navigator === 'undefined') {
    return false;
  }
  return /android/i.test(navigator.userAgent ?? '');
}

function normalizeNotificationPermissionState(
  rawValue: string | null | undefined,
): TimeblockEndAlertNotificationPermissionState {
  const normalized = rawValue?.trim().toLowerCase();
  if (normalized === 'granted' || normalized === 'prompt' || normalized === 'denied') {
    return normalized;
  }
  return 'unavailable';
}

function enqueueApply(operation: () => Promise<void>): Promise<void> {
  const nextOperation = applyQueue.catch(() => {}).then(operation);
  applyQueue = nextOperation;
  return nextOperation;
}

export function getTimeblockEndAlertSupport(): TimeblockEndAlertSupport {
  if (!isTauriWindow()) {
    return {
      supported: false,
      reason: '仅 Android App 支持后台时间块结束提醒',
    };
  }

  if (isDesktopOperatingSystem()) {
    return {
      supported: false,
      reason: '桌面端不需要 Android 后台提醒链路',
    };
  }

  if (!isAndroidTauriWindow()) {
    return {
      supported: false,
      reason: '当前平台暂未接入 Android 后台提醒链路',
    };
  }

  return {
    supported: true,
    reason: null,
  };
}

export async function scheduleTimeblockEndAlertInRuntime(
  request: TimeblockEndAlertRequest,
): Promise<void> {
  const support = getTimeblockEndAlertSupport();
  if (!support.supported) {
    lastScheduleSignature = null;
    return;
  }

  const nextSignature = JSON.stringify(request);
  return enqueueApply(async () => {
    if (lastScheduleSignature === nextSignature) {
      return;
    }

    await invoke('timeblock_end_alert_schedule', { request });
    lastScheduleSignature = nextSignature;
    runtimeSyncKnown = true;
  });
}

export async function cancelTimeblockEndAlertInRuntime(): Promise<void> {
  const support = getTimeblockEndAlertSupport();
  if (!support.supported) {
    lastScheduleSignature = null;
    return;
  }

  return enqueueApply(async () => {
    if (lastScheduleSignature === null && runtimeSyncKnown) {
      return;
    }

    await invoke('timeblock_end_alert_cancel');
    lastScheduleSignature = null;
    runtimeSyncKnown = true;
  });
}

export async function takePendingTimeblockEndHandoffFromRuntime(): Promise<PendingTimeblockEndHandoff | null> {
  const support = getTimeblockEndAlertSupport();
  if (!support.supported) {
    return null;
  }

  return invoke<PendingTimeblockEndHandoff | null>('timeblock_end_alert_take_pending_handoff');
}

export async function getTimeblockEndAlertNotificationPermissionStateInRuntime(): Promise<TimeblockEndAlertNotificationPermissionState> {
  const support = getTimeblockEndAlertSupport();
  if (!support.supported) {
    return 'unavailable';
  }

  const response = await invoke<{ state?: string | null }>('timeblock_end_alert_notification_permission_state');
  return normalizeNotificationPermissionState(response.state);
}

export async function requestTimeblockEndAlertNotificationPermissionInRuntime(): Promise<TimeblockEndAlertNotificationPermissionState> {
  const support = getTimeblockEndAlertSupport();
  if (!support.supported) {
    return 'unavailable';
  }

  const response = await invoke<{ state?: string | null }>('timeblock_end_alert_notification_permission_request');
  return normalizeNotificationPermissionState(response.state);
}
