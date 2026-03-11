import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Code, Download } from 'lucide-react';
import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import { SettingsToneProvider } from '@/ui/app/components/settings-shared';
import type {
  ActionSettingsItem,
  BooleanSettingsItem,
  CustomSettingsItem,
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

    expect(screen.getByRole('switch').getAttribute('style') ?? '').toContain('--switch-checked-bg: var(--settings-tone-color, #C75B3A)');
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

    expect(screen.getByRole('slider').getAttribute('style') ?? '').toContain('accent-color: var(--settings-tone-color, #C75B3A)');
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
      placeholder: 'http://127.0.0.1:6984',
      get: () => currentValue,
      set: setValue,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: /同步服务器/ }));
    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:6984'), {
      target: { value: 'http://localhost:6984' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(setValue).toHaveBeenCalledWith('http://localhost:6984');
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

  it('renders select enum helper text as a separate indented block', () => {
    const item: SingleEnumSettingsItem = {
      id: 'volcano-resource-model',
      label: '火山资源模型',
      icon: Code,
      rowTestId: 'volcano-resource-row',
      controlTestId: 'volcano-resource-select',
      category: 'input',
      type: 'enum',
      enumStyle: 'select',
      options: [
        { label: '默认模型', value: 'default' },
        { label: '模型 1.0 小时版', value: 'hour' },
      ],
      helperText: (value) => `当前默认资源：${value}`,
      get: () => 'default',
      set: vi.fn(),
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    const row = screen.getByTestId('volcano-resource-row');
    const helper = screen.getByText('当前默认资源：default');

    expect(row.querySelector('svg')).not.toBeNull();
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
