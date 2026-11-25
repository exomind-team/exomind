import { useEffect, useState } from 'react';
import {
  getQuickExitShortcut,
  getQuickExitShortcutScope,
  parseQuickExitShortcutScope,
  QUICK_EXIT_SHORTCUT_POLICY,
  subscribeQuickExitShortcutChanges,
  subscribeQuickExitShortcutScopeChanges,
} from '@/config/quick-exit-shortcut';
import { shortcutAcceleratorsEqual } from '@/config/shortcut-accelerator';
import { syncQuickExitShortcutWithRuntime } from '@/services/quick-exit-shortcut-runtime';
import { FieldSelect } from '@/components/ui/field-select';
import {
  ShortcutCaptureField,
  useShortcutCapture,
} from '@/ui/app/components/settings/shortcut-capture';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

export function QuickExitShortcutSetting(_props: { ctx: SettingsContext }) {
  const [hotkey, setHotkey] = useState<string | null>(() => getQuickExitShortcut());
  const [scope, setScope] = useState(() => getQuickExitShortcutScope());
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState('');
  const [scopeNotice, setScopeNotice] = useState('');

  useEffect(() => subscribeQuickExitShortcutChanges(setHotkey), []);
  useEffect(() => subscribeQuickExitShortcutScopeChanges(setScope), []);

  const changeScope = async (rawScope: string) => {
    const nextScope = parseQuickExitShortcutScope(rawScope);
    if (!nextScope || nextScope === scope || scopeBusy) return;
    setScopeBusy(true);
    setScopeError('');
    setScopeNotice('');
    try {
      const status = await syncQuickExitShortcutWithRuntime({ scope: nextScope });
      const currentHotkey = getQuickExitShortcut();
      if (currentHotkey && status.kind !== 'valid') {
        throw new Error('快捷键未确认生效，作用范围没有更改。');
      }
      if (!currentHotkey && status.kind !== 'unassigned') {
        throw new Error('快捷键状态未确认，作用范围没有更改。');
      }
      setScope(nextScope);
      setScopeNotice(nextScope === 'app-only'
        ? '仅当外心主窗或浮窗位于前台时响应，不占用其他应用的快捷键。'
        : '其他应用位于前台时也会请求退出外心。');
    } catch (failure) {
      setScope(getQuickExitShortcutScope());
      setScopeError(failure instanceof Error ? failure.message : '快捷键作用范围未能保存，请重试。');
    } finally {
      setScopeBusy(false);
    }
  };

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
    <div data-quick-exit-capture-active={capture.capturing ? 'true' : undefined} className="space-y-2">
      <ShortcutCaptureField
        label="快速退出快捷键"
        description="点击后直接按下组合键；Esc 取消，Backspace 清除。"
        warning="按下后立即请求退出（等待内置运行时停止后关闭），不会等待前端未保存草稿，请先保存内容。"
        value={hotkey}
        testId="new-settings-quick-exit-shortcut-row"
        capture={capture}
      />
      <div className="space-y-1 px-4 pb-2">
        <FieldSelect
          label="快速退出快捷键作用范围"
          value={scope}
          disabled={scopeBusy}
          onValueChange={value => { void changeScope(value); }}
          options={[
            { value: 'app-only', label: '仅外心窗口' },
            { value: 'system-global', label: '系统全局' },
          ]}
        />
        <p className="text-xs text-[#A8A29E]">
          {scope === 'app-only'
            ? '仅外心主窗或浮窗位于前台时响应；其他应用的同一快捷键不受影响。'
            : '其他应用位于前台时也会请求退出外心。'}
        </p>
        {scopeNotice && <p role="status" className="text-xs text-[#78716C]">{scopeNotice}</p>}
        {scopeError && <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#FCA5A5]">{scopeError}</p>}
      </div>
    </div>
  );
}
