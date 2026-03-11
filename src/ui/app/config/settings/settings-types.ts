import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Category =
  | 'appearance'
  | 'timer'
  | 'input'
  | 'feedback'
  | 'ai'
  | 'sync'
  | 'data'
  | 'developer'
  | 'danger';

export interface SettingsContext {
  isDesktop: boolean;
  developerMode?: boolean;
  desktopAdaptiveEnabled?: boolean;
  voiceShortcutAsrProvider?: string;
}

export interface SettingsItemBase {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  category: Category;
  rowTestId?: string;
  visible?: (ctx: SettingsContext) => boolean;
}

export interface BooleanSettingsItem extends SettingsItemBase {
  type: 'boolean';
  controlTestId?: string;
  get: () => boolean;
  set: (value: boolean) => boolean | void | Promise<boolean | void>;
  subscribe?: (cb: (value: boolean) => void) => () => void;
  successMessage?: string | ((value: boolean) => string);
  errorMessagePrefix?: string;
}

export interface SingleEnumSettingsItem extends SettingsItemBase {
  type: 'enum';
  multiSelect?: false;
  enumStyle?: 'segmented' | 'select';
  controlTestId?: string;
  optionTestId?: (value: string, index: number) => string | undefined;
  helperText?: (value: string) => string | null;
  options: { label: string; value: string; icon?: LucideIcon }[];
  get: () => string;
  set: (value: string) => string | void | Promise<string | void>;
  subscribe?: (cb: (value: string) => void) => () => void;
  successMessage?: string | ((value: string) => string);
  errorMessagePrefix?: string;
}

export interface MultiEnumSettingsItem extends SettingsItemBase {
  type: 'enum';
  multiSelect: true;
  enumStyle?: 'segmented' | 'select';
  controlTestId?: string;
  optionTestId?: (value: string, index: number) => string | undefined;
  options: { label: string; value: string; icon?: LucideIcon }[];
  get: () => string[];
  set: (values: string[]) => string[] | void | Promise<string[] | void>;
  subscribe?: (cb: (value: string[]) => void) => () => void;
  successMessage?: string | ((value: string[]) => string);
  errorMessagePrefix?: string;
}

export type EnumSettingsItem = SingleEnumSettingsItem | MultiEnumSettingsItem;

export interface NumberSettingsItem extends SettingsItemBase {
  type: 'number';
  controlTestId?: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  formatValue?: (value: number) => string;
  get: () => number;
  set: (value: number) => number | void | Promise<number | void>;
  subscribe?: (cb: (value: number) => void) => () => void;
  successMessage?: string | ((value: number) => string);
  errorMessagePrefix?: string;
}

export interface StringSettingsItem extends SettingsItemBase {
  type: 'string';
  controlTestId?: string;
  stringStyle?: 'inline' | 'dialog';
  sensitive?: boolean;
  placeholder?: string;
  dialogTitle?: string;
  dialogDescription?: string;
  emptyValueLabel?: string;
  get: () => string;
  set: (value: string) => string | void | Promise<string | void>;
  subscribe?: (cb: (value: string) => void) => () => void;
  validate?: (value: string) => string | null;
  mask?: (value: string) => string;
  successMessage?: string | ((value: string) => string);
  errorMessagePrefix?: string;
}

export interface ActionSettingsItem extends SettingsItemBase {
  type: 'action';
  actionMode?: 'row' | 'button';
  buttonLabel?: string;
  variant?: 'default' | 'destructive' | 'outline';
  disabled?: boolean | (() => boolean);
  disabledReason?: string;
  confirmMessage?: string;
  onAction: () => string | void | Promise<string | void>;
  successMessage?: string;
  errorMessagePrefix?: string;
}

export interface GroupSettingsItem extends SettingsItemBase {
  type: 'group';
  children: SettingsItem[];
}

export interface CustomSettingsItem extends SettingsItemBase {
  type: 'custom';
  component: ComponentType<{ ctx: SettingsContext }>;
}

export type SettingsItem =
  | BooleanSettingsItem
  | EnumSettingsItem
  | NumberSettingsItem
  | StringSettingsItem
  | ActionSettingsItem
  | GroupSettingsItem
  | CustomSettingsItem;
