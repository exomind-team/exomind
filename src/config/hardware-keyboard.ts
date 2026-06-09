/**
 * 硬件键盘状态检测
 *
 * Android 端：Kotlin onConfigurationChanged → evaluateJavascript → 前端 JS
 *            → invoke('signal_publish_fast') → RT SignalPool → SSE 回传
 * 桌面端：始终认为有键盘（桌面 RT 启动时也会发一次初始状态信号）
 * Web 端：监听首次 keydown 推断
 *
 * 状态权威来源是 RT SignalPool（topic: device.keyboard.state）。
 * 本模块只管理前端侧的状态缓存和订阅。
 */

import { invoke } from '@tauri-apps/api/core';
import { isDesktopOperatingSystem, isTauriWindow } from './runtime-target';

export const KEYBOARD_STATE_SIGNAL_TOPIC = 'device.keyboard.state';

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

/**
 * 将键盘状态发布到 RT SignalPool（通过 Tauri invoke 快速通道）。
 * Kotlin 推送和前端首次 keydown 推断都会调这个函数。
 */
async function publishKeyboardStateToRT(state: HardwareKeyboardState): Promise<void> {
  if (!isTauriWindow()) {
    return; // Web 端没有 RT，只更新本地状态
  }

  try {
    await invoke('signal_publish_fast', {
      request: {
        topic: KEYBOARD_STATE_SIGNAL_TOPIC,
        source: 'platform:keyboard-detector',
        payload: {
          hasHardwareKeyboard: state.hasHardwareKeyboard,
          keyboardType: state.keyboardType,
        },
      },
    });
  } catch {
    // RT 可能还没启动，静默忽略
  }
}

/**
 * 从 RT 信号 payload 中更新本地状态（SSE 收到 device.keyboard.state 时调用）。
 */
export function applyKeyboardStateFromSignal(payload: Record<string, unknown>): void {
  const hasHardwareKeyboard = Boolean(payload.hasHardwareKeyboard);
  const keyboardType = (typeof payload.keyboardType === 'string'
    ? payload.keyboardType
    : 'none') as HardwareKeyboardState['keyboardType'];

  currentState = { hasHardwareKeyboard, keyboardType };
  notifyListeners();
}

// ── Android 端：接收 Kotlin evaluateJavascript 推送 → 转发到 RT ──

if (typeof window !== 'undefined') {
  // Kotlin 推送 CustomEvent，前端收到后转发到 RT
  window.addEventListener('exomind:keyboard-state', ((event: CustomEvent<{
    hasHardwareKeyboard: boolean;
    keyboardType: string;
  }>) => {
    const { hasHardwareKeyboard, keyboardType } = event.detail;
    const newState: HardwareKeyboardState = {
      hasHardwareKeyboard,
      keyboardType: keyboardType as HardwareKeyboardState['keyboardType'],
    };
    // 先更新本地（即时响应）
    currentState = newState;
    notifyListeners();
    // 再发到 RT（让 RT 成为权威来源，其他设备也能感知）
    void publishKeyboardStateToRT(newState);
  }) as EventListener);

  // Web 端（非 Tauri）：监听首次物理键盘按键推断
  if (!isTauriWindow() && !isDesktopOperatingSystem()) {
    const handleFirstKeydown = (event: KeyboardEvent) => {
      if (event.code && event.code.length > 0) {
        const newState: HardwareKeyboardState = { hasHardwareKeyboard: true, keyboardType: 'qwerty' };
        currentState = newState;
        notifyListeners();
        window.removeEventListener('keydown', handleFirstKeydown);
      }
    };
    window.addEventListener('keydown', handleFirstKeydown);
  }
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
