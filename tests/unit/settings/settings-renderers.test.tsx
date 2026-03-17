import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Code, Download, Key } from 'lucide-react';
import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import { SettingsToneProvider } from '@/ui/app/components/settings-shared';
import type {
  ActionSettingsItem,
  BooleanSettingsItem,
  CustomSettingsItem,
  GroupSettingsItem,
  MultiEnumSettingsItem,
  NumberSettingsItem,
  SettingsContext,
  SingleEnumSettingsItem,
  StringSettingsItem,
} from '@/ui/app/config/settings/settings-types';

const ctx: SettingsContext = { isDesktop: false };

describe('SettingsItemRenderer', () => {
  it('renders boolean items with switch behavior', () => {
    let currentValue = true;
    const listeners = new Set<(value: boolean) => void>();
    const setValue = vi.fn((value: boolean) => {
      currentValue = value;
      listeners.forEach((listener) => listener(value));
    });

    const item: BooleanSettingsItem = {
      id: 'developer-mode',
      label: '开发者模式',
      category: 'developer',
      type: 'boolean',
      get: () => currentValue,
      set: setValue,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const control = screen.getByRole('switch');
    expect(control).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(control);

    expect(setValue).toHaveBeenCalledWith(false);
  });

  it('renders boolean item helper text as a separate indented block and keeps the row icon', () => {
    let currentValue = true;
    const item: BooleanSettingsItem = {
      id: 'developer-mode',
      label: '开发者模式',
      description: '开启后可使用语音测试等实验功能',
      icon: Code,
      rowTestId: 'developer-mode-row',
      category: 'developer',
      type: 'boolean',
      get: () => currentValue,
      set: (value: boolean) => {
        currentValue = value;
      },
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const row = screen.getByTestId('developer-mode-row');
    const helper = screen.getByText('开启后可使用语音测试等实验功能');

    expect(row.querySelector('svg')).not.toBeNull();
    expect(row).not.toContainElement(helper);
    expect(helper.parentElement?.className).toContain('pl-[46px]');
  });

  it('renders enum items as segmented buttons by default', () => {
    const setValue = vi.fn();
    const item: SingleEnumSettingsItem = {
      id: 'theme',
      label: '主题',
      category: 'appearance',
      type: 'enum',
      options: [
        { label: '自动', value: 'system' },
        { label: '浅色', value: 'light' },
      ],
      get: () => 'system',
      set: setValue,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    expect(screen.getByRole('button', { name: '自动' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '浅色' }));
    expect(setValue).toHaveBeenCalledWith('light');
  });

  it('renders single-select inline enum with an adaptive active-indicator shell', () => {
    const item: SingleEnumSettingsItem = {
      id: 'voice-transcript-send-mode',
      label: '语音转写后',
      category: 'input',
      type: 'enum',
      options: [
        { label: '插入输入框', value: 'insert' },
        { label: '直接发送', value: 'direct-send' },
      ],
      get: () => 'insert',
      set: vi.fn(),
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const group = screen.getByRole('group', { name: '语音转写后' });
    expect(group.className).toContain('inline-flex');
    expect(group.querySelector('[data-active-indicator=\"true\"]')).not.toBeNull();
  });

  it('uses toneColor for single-select inline enum selected fill layers', () => {
    const item: SingleEnumSettingsItem = {
      id: 'voice-transcript-send-mode',
      label: '语音转写后',
      category: 'input',
      type: 'enum',
      options: [
        { label: '插入输入框', value: 'insert' },
        { label: '直接发送', value: 'direct-send' },
      ],
      get: () => 'insert',
      set: vi.fn(),
    };

    render(
      <SettingsToneProvider toneColor="var(--settings-tone-developer)">
        <SettingsItemRenderer item={item} ctx={ctx} />
      </SettingsToneProvider>,
    );

    const indicator = screen
      .getByRole('group', { name: '语音转写后' })
      .querySelector('[data-active-indicator=\"true\"]');
    const fill = indicator?.querySelector('[data-active-indicator-fill=\"true\"]');

    expect(fill).not.toBeNull();
    expect(indicator?.className ?? '').toContain('settings-tone-border');
    expect(fill?.className ?? '').toContain('settings-tone-fill');
    expect(fill?.getAttribute('style') ?? '').toContain('--settings-tone-color: var(--settings-tone-developer)');
  });

  it('renders multi-select inline enum with per-option fade overlays', () => {
    const setValue = vi.fn();
    const item: MultiEnumSettingsItem = {
      id: 'feedback-content',
      label: '反馈内容',
      category: 'feedback',
      type: 'enum',
      multiSelect: true,
      options: [
        { label: '时刻信息', value: 'timing' },
        { label: '统计信息', value: 'statistics' },
        { label: '快速反馈', value: 'quick' },
      ],
      get: () => ['timing', 'quick'],
      set: setValue,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const timingButton = screen.getByRole('button', { name: '时刻信息' });
    const statisticsButton = screen.getByRole('button', { name: '统计信息' });
    const quickButton = screen.getByRole('button', { name: '快速反馈' });

    expect(timingButton.querySelector('[data-selection-overlay=\"true\"]')?.className).toContain('opacity-100');
    expect(statisticsButton.querySelector('[data-selection-overlay=\"true\"]')?.className).toContain('opacity-0');
    expect(quickButton.querySelector('[data-selection-overlay=\"true\"]')?.className).toContain('opacity-100');

    fireEvent.click(statisticsButton);

    expect(setValue).toHaveBeenCalledWith(['timing', 'statistics', 'quick']);
  });

  it('uses toneColor for multi-select inline enum selected fill layers', () => {
    const item: MultiEnumSettingsItem = {
      id: 'feedback-content',
      label: '反馈内容',
      category: 'feedback',
      type: 'enum',
      multiSelect: true,
      options: [
        { label: '时刻信息', value: 'timing' },
        { label: '统计信息', value: 'statistics' },
        { label: '快速反馈', value: 'quick' },
      ],
      get: () => ['timing', 'quick'],
      set: vi.fn(),
    };

    render(
      <SettingsToneProvider toneColor="var(--settings-tone-developer)">
        <SettingsItemRenderer item={item} ctx={ctx} />
      </SettingsToneProvider>,
    );

    const timingOverlay = screen
      .getByRole('button', { name: '时刻信息' })
      .querySelector('[data-selection-overlay=\"true\"]');
    const fill = timingOverlay?.querySelector('[data-selection-fill=\"true\"]');

    expect(fill).not.toBeNull();
    expect(timingOverlay?.className ?? '').toContain('settings-tone-border');
    expect(fill?.className ?? '').toContain('settings-tone-fill');
    expect(fill?.getAttribute('style') ?? '').toContain('--settings-tone-color: var(--settings-tone-developer)');
  });

  it('keeps shared edges straight and removes the seam between adjacent multi-select highlights', () => {
    const item: MultiEnumSettingsItem = {
      id: 'feedback-content',
      label: '反馈内容',
      category: 'feedback',
      type: 'enum',
      multiSelect: true,
      options: [
        { label: '时刻信息', value: 'timing' },
        { label: '统计信息', value: 'statistics' },
        { label: '快速反馈', value: 'quick' },
      ],
      get: () => ['timing', 'statistics'],
      set: vi.fn(),
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const timingOverlay = screen
      .getByRole('button', { name: '时刻信息' })
      .querySelector('[data-selection-overlay=\"true\"]');
    const statisticsOverlay = screen
      .getByRole('button', { name: '统计信息' })
      .querySelector('[data-selection-overlay=\"true\"]');

    expect(timingOverlay?.className).toContain('rounded-r-none');
    expect(timingOverlay?.className).toContain('border-r-0');
    expect(statisticsOverlay?.className).toContain('rounded-l-none');
    expect(statisticsOverlay?.className).toContain('border-l-0');
    expect(statisticsOverlay?.className).toContain('rounded-r-[9px]');
  });

  it('uses toneColor for boolean switch checked backgrounds', () => {
    const item: BooleanSettingsItem = {
      id: 'developer-mode',
      label: '开发者模式',
      category: 'developer',
      type: 'boolean',
      get: () => true,
      set: vi.fn(),
    };

    render(
      <SettingsToneProvider toneColor="var(--settings-tone-developer)">
        <SettingsItemRenderer item={item} ctx={ctx} />
      </SettingsToneProvider>,
    );

    expect(screen.getByRole('switch').getAttribute('style') ?? '').toContain(
      '--switch-checked-bg: var(--settings-tone-color, var(--settings-tone-default))',
    );
  });

  it('uses toneColor for range controls', () => {
    const item: NumberSettingsItem = {
      id: 'voice-overlay-opacity',
      label: '悬浮窗透明度',
      category: 'input',
      type: 'number',
      min: 20,
      max: 98,
      step: 1,
      get: () => 62,
      set: vi.fn(),
    };

    render(
      <SettingsToneProvider toneColor="var(--settings-tone-developer)">
        <SettingsItemRenderer item={item} ctx={ctx} />
      </SettingsToneProvider>,
    );

    const slider = screen.getByRole('slider');

    expect(slider.className).toContain('settings-range');
    expect(slider.getAttribute('style') ?? '').toContain(
      'accent-color: var(--settings-tone-color, var(--settings-tone-default))',
    );
    expect(slider.getAttribute('style') ?? '').toContain('--settings-range-progress: 53.85%');
  });

  it('renders dialog string items and saves edited values', () => {
    let currentValue = '';
    const setValue = vi.fn((value: string) => {
      currentValue = value;
    });

    const item: StringSettingsItem = {
      id: 'sync-server-url',
      label: '同步服务器',
      category: 'sync',
      type: 'string',
      stringStyle: 'dialog',
      dialogFieldKind: 'plain',
      dialogInputType: 'url',
      placeholder: 'http://127.0.0.1:6984',
      dialogTitle: '同步服务器',
      dialogDescription: '设置事件日志同步的服务器地址',
      get: () => currentValue,
      set: setValue,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: /同步服务器/ }));

    const dialog = screen.getByRole('dialog', { name: '同步服务器' });
    expect(within(dialog).getByText('设置事件日志同步的服务器地址')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '显示 Token' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: '清空' })).toBeNull();

    const input = within(dialog).getByPlaceholderText('http://127.0.0.1:6984');
    expect(input).toHaveAttribute('type', 'url');

    const cancelButton = within(dialog).getByRole('button', { name: '取消' });
    const saveButton = within(dialog).getByRole('button', { name: '保存' });
    expect(cancelButton.className).toContain('flex-1');
    expect(saveButton.className).toContain('flex-1');

    fireEvent.change(input, {
      target: { value: 'http://localhost:6984' },
    });
    fireEvent.click(saveButton);

    expect(setValue).toHaveBeenCalledWith('http://localhost:6984');
  });

  it('renders dialog enum items with descriptions inside a dialog picker', () => {
    const item = {
      id: 'countdown-end-mode',
      label: '倒计时结束',
      icon: Code,
      category: 'timer',
      type: 'enum',
      enumStyle: 'dialog',
      dialogTitle: '倒计时结束模式',
      dialogDescription: '选择倒计时结束后的行为',
      options: [
        { label: '硬停止', value: 'hard', description: '倒计时结束后立即停止' },
        { label: '柔和提醒', value: 'soft', description: '倒计时结束后继续计时并提醒' },
      ],
      get: () => 'soft',
      set: vi.fn(),
    } as unknown as SingleEnumSettingsItem;

    render(
      <SettingsToneProvider toneColor="var(--settings-tone-developer)">
        <SettingsItemRenderer item={item} ctx={ctx} />
      </SettingsToneProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /倒计时结束/ }));

    const dialog = screen.getByRole('dialog', { name: '倒计时结束模式' });
    const selectedOption = within(dialog).getByRole('button', { name: /柔和提醒/ });

    expect(within(dialog).getByText('倒计时结束后立即停止')).toBeInTheDocument();
    expect(within(dialog).getByText('倒计时结束后继续计时并提醒')).toBeInTheDocument();
    expect(selectedOption.className).toContain('settings-dialog-option-card');
    expect(selectedOption.querySelector('[data-selection-overlay=\"true\"]')).not.toBeNull();
  });

  it('renders dialog enum items without descriptions using adaptive option cards', () => {
    const item = {
      id: 'sound-preset',
      label: '提示音',
      icon: Code,
      category: 'timer',
      type: 'enum',
      enumStyle: 'dialog',
      dialogTitle: '选择提示音',
      dialogDescription: '倒计时结束时播放的提示音',
      options: [
        { label: '关闭提示音', value: 'off' },
        { label: 'Ring 10', value: 'ring-10' },
      ],
      get: () => 'ring-10',
      set: vi.fn(),
    } as unknown as SingleEnumSettingsItem;

    render(
      <SettingsToneProvider toneColor="var(--settings-tone-developer)">
        <SettingsItemRenderer item={item} ctx={ctx} />
      </SettingsToneProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /提示音/ }));

    const dialog = screen.getByRole('dialog', { name: '选择提示音' });
    const option = within(dialog).getByRole('button', { name: 'Ring 10' });

    expect(within(dialog).getByText('倒计时结束时播放的提示音')).toBeInTheDocument();
    expect(option.className).toContain('settings-dialog-option-card');
    expect(option.querySelector('[data-selection-overlay=\"true\"]')).not.toBeNull();
  });

  it('renders single-value secret dialogs with footer metadata and clear action', () => {
    let currentValue = 'sk-test-123456';
    const setValue = vi.fn((value: string) => {
      currentValue = value;
      return value;
    });

    const item = {
      id: 'moss-api-token',
      label: 'MOSS API Token',
      icon: Key,
      category: 'input',
      type: 'string',
      stringStyle: 'dialog',
      sensitive: true,
      placeholder: '输入 MOSS API Token',
      dialogTitle: '语音输入设置',
      dialogDescription: '配置 MOSS API Token（仅保存在当前设备）',
      dialogFieldKind: 'secret',
      dialogFooterStart: {
        type: 'secret-toggle',
        showLabel: '显示 Token',
        hideLabel: '隐藏 Token',
      },
      dialogFooterEnd: '用于新 UI 语音输入转写',
      allowClear: true,
      get: () => currentValue,
      set: setValue,
      mask: (value: string) => `已配置 (${value.slice(0, 4)}***${value.slice(-2)})`,
    } as unknown as StringSettingsItem;

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const row = screen.getByRole('button', { name: /MOSS API Token/ });
    expect(row.querySelector('.lucide-key')).not.toBeNull();

    fireEvent.click(row);

    const dialog = screen.getByRole('dialog', { name: '语音输入设置' });
    expect(within(dialog).getByRole('button', { name: '显示 Token' })).toBeInTheDocument();
    expect(within(dialog).getByText('用于新 UI 语音输入转写')).toBeInTheDocument();

    const cancelButton = within(dialog).getByRole('button', { name: '取消' });
    const clearButton = within(dialog).getByRole('button', { name: '清空' });
    const saveButton = within(dialog).getByRole('button', { name: '保存' });

    expect(cancelButton.className).toContain('flex-1');
    expect(clearButton.className).toContain('flex-1');
    expect(saveButton.className).toContain('flex-1');

    fireEvent.click(clearButton);

    expect(setValue).toHaveBeenCalledWith('');
  });

  it('renders action items as buttons', () => {
    const onAction = vi.fn();
    const item: ActionSettingsItem = {
      id: 'export-backup',
      label: '导出备份',
      icon: Download,
      rowTestId: 'export-backup-row',
      category: 'data',
      type: 'action',
      onAction,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: '导出备份' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('export-backup-row').querySelector('svg')).not.toBeNull();
  });

  it('renders button-mode action items with separate CTA buttons', () => {
    const onAction = vi.fn();
    const item: ActionSettingsItem = {
      id: 'clear-local-cache',
      label: '清空本地缓存',
      description: '将清除设备上的临时设置与缓存',
      category: 'danger',
      type: 'action',
      actionMode: 'button',
      buttonLabel: '立即清空',
      onAction,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    expect(screen.getByText('清空本地缓存')).toBeInTheDocument();
    expect(screen.getByText('将清除设备上的临时设置与缓存')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '立即清空' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders group items as interactive containers that expose child settings', () => {
    const childSet = vi.fn();
    const item: GroupSettingsItem = {
      id: 'feature-toggles',
      label: '功能开关',
      category: 'developer',
      type: 'group',
      groupStyle: 'adaptive-overlay',
      dialogTitle: '功能开关',
      dialogDescription: '启用或关闭实验性功能',
      children: [
        {
          id: 'desktop-adaptive',
          label: '桌面端适配',
          category: 'developer',
          type: 'boolean',
          get: () => true,
          set: childSet,
        },
      ],
    };

    render(<SettingsItemRenderer item={item} ctx={{ isDesktop: false, isLandscape: true }} />);

    fireEvent.click(screen.getByRole('button', { name: /功能开关/ }));

    expect(screen.getByText('启用或关闭实验性功能')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByText('桌面端适配')).toBeInTheDocument();
  });

  it('keeps confirmMessage behavior for button-mode action items', () => {
    const confirmSpy = vi.fn(() => false);
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: confirmSpy,
    });
    const onAction = vi.fn();
    const item: ActionSettingsItem = {
      id: 'reset-all-settings',
      label: '重置所有设置',
      description: '恢复默认配置，不影响历史事件数据',
      category: 'danger',
      type: 'action',
      actionMode: 'button',
      buttonLabel: '恢复默认',
      confirmMessage: '确认恢复所有默认设置？',
      onAction,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));

    expect(confirmSpy).toHaveBeenCalledWith('确认恢复所有默认设置？');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('renders inline enum helper text as a separate indented block', () => {
    const item: SingleEnumSettingsItem = {
      id: 'volcano-resource-model',
      label: '火山资源模型',
      icon: Code,
      rowTestId: 'volcano-resource-row',
      category: 'input',
      type: 'enum',
      options: [
        { label: '1.0 小时版', value: 'hour' },
        { label: '2.0 小时版', value: 'seed-hour' },
      ],
      helperText: (value) => `当前默认资源：${value}`,
      get: () => 'hour',
      set: vi.fn(),
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const row = screen.getByTestId('volcano-resource-row');
    const helper = screen.getByText('当前默认资源：hour');
    const group = screen.getByRole('group', { name: '火山资源模型' });

    expect(row.querySelector('svg')).not.toBeNull();
    expect(within(group).getByRole('button', { name: '1.0 小时版' })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /模型 1\.0/ })).toBeNull();
    expect(row).not.toContainElement(helper);
    expect(helper.parentElement?.className).toContain('pl-[46px]');
  });

  it('renders custom components directly', () => {
    const item: CustomSettingsItem = {
      id: 'custom-debug',
      label: '自定义',
      category: 'developer',
      type: 'custom',
      component: ({ ctx: currentCtx }) => (
        <div data-testid="custom-setting">{currentCtx.isDesktop ? 'desktop' : 'mobile'}</div>
      ),
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    expect(screen.getByTestId('custom-setting')).toHaveTextContent('mobile');
  });
});
