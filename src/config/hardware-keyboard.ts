/**
 * 硬件键盘状态检测
 *
 * Android 端：通过 MainActivity.onConfigurationChanged() 推送的 CustomEvent 驱动
 * 桌面端：始终认为有键盘
 * Web 端：监听首次 keydown 推断
 */

import { isDesktopOperatingSystem, isTauriWindow } from './runtime-target';

export interface HardwareKeyboardState {
  hasHardwareKeyboard: boolean;
  keyboardType: 'qwerty' | '12key' | 'none' | 'desktop';
}

type KeyboardStateListener = (state: HardwareKeyboardState) => void;

const listeners = new Set<KeyboardStateListener>();
let currentState: HardwareKeyboardState = resolveInitialState();

function resolveInitialState(): HardwareKeyboardState {
  if (isDesktopOperatingSystem()) {
    return { hasHardwareKeyboard: true, keyboardType: 'desktop' };
  }
  return { hasHardwareKeyboard: false, keyboardType: 'none' };
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentState);
  }
}

// Android 端：接收 Kotlin 推送的 CustomEvent
if (typeof window !== 'undefined') {
  window.addEventListener('exomind:keyboard-state', ((event: CustomEvent<{
    hasHardwareKeyboard: boolean;
    keyboardType: string;
  }>) => {
    const { hasHardwareKeyboard, keyboardType } = event.detail;
    currentState = {
      hasHardwareKeyboard,
      keyboardType: keyboardType as HardwareKeyboardState['keyboardType'],
    };
    notifyListeners();
  }) as EventListener);

  // Web 端（非 Tauri）：监听首次物理键盘按键推断
  if (!isTauriWindow() && !isDesktopOperatingSystem()) {
    const handleFirstKeydown = (event: KeyboardEvent) => {
      // 软键盘的 keydown 没有 code 属性或 code 为空
      if (event.code && event.code.length > 0) {
        currentState = { hasHardwareKeyboard: true, keyboardType: 'qwerty' };
        notifyListeners();
        window.removeEventListener('keydown', handleFirstKeydown);
      }
    };
    window.addEventListener('keydown', handleFirstKeydown);
  }
}

// 给 Kotlin 侧的全局回调（备用通道）
if (typeof window !== 'undefined') {
  (window as Window & { __EXOMIND_KEYBOARD_STATE__?: (has: boolean, type: string) => void }).__EXOMIND_KEYBOARD_STATE__ = (
    has: boolean,
    type: string,
  ) => {
    currentState = {
      hasHardwareKeyboard: has,
      keyboardType: type as HardwareKeyboardState['keyboardType'],
    };
    notifyListeners();
  };
}

export function getHardwareKeyboardState(): HardwareKeyboardState {
  return currentState;
}

export function subscribeHardwareKeyboardState(listener: KeyboardStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
