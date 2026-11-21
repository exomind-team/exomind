import { useEffect, useState } from 'react';
import {
  getQuickExitShortcut,
  QUICK_EXIT_SHORTCUT_POLICY,
  subscribeQuickExitShortcutChanges,
} from '@/config/quick-exit-shortcut';
import { shortcutAcceleratorsEqual } from '@/config/shortcut-accelerator';
import { syncQuickExitShortcutWithRuntime } from '@/services/quick-exit-shortcut-runtime';
import {
  ShortcutCaptureField,
  useShortcutCapture,
} from '@/ui/app/components/settings/shortcut-capture';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

export function QuickExitShortcutSetting(_props: { ctx: SettingsContext }) {
  const [hotkey, setHotkey] = useState<string | null>(() => getQuickExitShortcut());

  useEffect(() => subscribeQuickExitShortcutChanges(setHotkey), []);

  const capture = useShortcutCapture({
    policy: QUICK_EXIT_SHORTCUT_POLICY,
    successMessage: (accelerator) => `已设置：${accelerator}`,
    clearSuccessMessage: '已清除：快速退出快捷键未设置。',
    onCommit: async (accelerator) => {
      const status = await syncQuickExitShortcutWithRuntime({ hotkey: accelerator });
      if (status.kind === 'conflict') {
        throw new Error(status.message);
      }
      if (
        status.kind !== 'valid'
        || !shortcutAcceleratorsEqual(status.hotkey, accelerator)
      ) {
        throw new Error('保存失败：快捷键未生效。');
      }
      setHotkey(status.hotkey);
    },
    onClear: async () => {
      const status = await syncQuickExitShortcutWithRuntime({ hotkey: null });
      if (status.kind !== 'unassigned') {
        throw new Error('清除失败：快捷键仍未确认解除。');
      }
      setHotkey(null);
    },
  });

  return (
    <ShortcutCaptureField
      label="快速退出快捷键"
      description="点击后直接按下组合键；Esc 取消，Backspace 清除。"
      warning="按下后立即请求退出（等待内置运行时停止后关闭），不会等待前端未保存草稿，请先保存内容。"
      value={hotkey}
      testId="new-settings-quick-exit-shortcut-row"
      capture={capture}
    />
  );
}
