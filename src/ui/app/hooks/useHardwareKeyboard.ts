import { useEffect, useState } from 'react';
import {
  getHardwareKeyboardState,
  subscribeHardwareKeyboardState,
  type HardwareKeyboardState,
} from '@/config/hardware-keyboard';

/**
 * 检测当前设备是否有硬件键盘连接。
 *
 * - Android：通过 onConfigurationChanged 事件驱动，实时感知连接/断开
 * - 桌面端：始终返回 true
 * - Web 端：监听首次 keydown 推断
 */
export function useHardwareKeyboard(): HardwareKeyboardState {
  const [state, setState] = useState(getHardwareKeyboardState);

  useEffect(() => {
    return subscribeHardwareKeyboardState(setState);
  }, []);

  return state;
}
