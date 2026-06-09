import { invoke } from '@tauri-apps/api/core';
import { isDesktopOperatingSystem, isTauriWindow } from '@/config/runtime-target';

export interface FocusKeepAwakeSupport {
  supported: boolean;
  reason: string | null;
}

let lastAppliedValue: boolean | null = null;
let applyQueue: Promise<void> = Promise.resolve();

function isAndroidTauriWindow(): boolean {
  if (!isTauriWindow() || typeof navigator === 'undefined') {
    return false;
  }
  return /android/i.test(navigator.userAgent ?? '');
}

export function getFocusKeepAwakeSupport(): FocusKeepAwakeSupport {
  if (!isTauriWindow()) {
    return {
      supported: false,
      reason: '仅 Android App 支持保持亮屏',
    };
  }

  if (isDesktopOperatingSystem()) {
    return {
      supported: false,
      reason: '桌面端不需要保持亮屏',
    };
  }

  if (!isAndroidTauriWindow()) {
    return {
      supported: false,
      reason: '当前平台暂未接入保持亮屏',
    };
  }

  return {
    supported: true,
    reason: null,
  };
}

export async function setFocusKeepAwakeEnabledInRuntime(enabled: boolean): Promise<void> {
  const support = getFocusKeepAwakeSupport();
  if (!support.supported) {
    lastAppliedValue = null;
    return;
  }

  const applyOperation = async () => {
    if (lastAppliedValue === enabled) {
      return;
    }

    try {
      await invoke('focus_keep_awake_set', { enabled });
      lastAppliedValue = enabled;
    } catch (error) {
      lastAppliedValue = null;
      throw error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : '设置保持亮屏失败');
    }
  };

  const nextOperation = applyQueue.catch(() => {}).then(applyOperation);
  applyQueue = nextOperation;
  return nextOperation;
}
