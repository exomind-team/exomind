import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import type {
  ActionSettingsItem,
  BooleanSettingsItem,
  CustomSettingsItem,
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
      category: 'data',
      type: 'action',
      onAction,
    };

    render(<SettingsItemRenderer item={item} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: '导出备份' }));
    expect(onAction).toHaveBeenCalledTimes(1);
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
