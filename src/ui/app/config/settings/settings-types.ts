import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/*
 * AGENT GUIDE: SETTINGS SYSTEM
 *
 * This file defines the schema for the settings UI layer.
 *
 * Important boundaries:
 * - `SettingsItem` models how a setting is exposed in the settings page.
 * - Runtime truth still lives in the underlying config/service modules that each item calls via `get` / `set` / `subscribe`.
 * - Do not treat the registry object as a persistent store or a cross-feature read API.
 *
 * When adding a setting:
 * - First choose the narrowest existing family: `boolean`, `enum`, `number`, `string`, `action`, `group`.
 * - Use `group` when the entry opens a second surface that contains multiple child settings.
 * - Only use `custom` when the existing families cannot express the dev-aligned UI. If you think `custom` is needed,
 *   prove that there is no reusable dev reference first.
 */

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
  isLandscape?: boolean;
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
  enumStyle?: 'segmented' | 'select' | 'dialog';
  controlTestId?: string;
  optionTestId?: (value: string, index: number) => string | undefined;
  helperText?: (value: string) => string | null;
  dialogTitle?: string;
  dialogDescription?: string;
  options: { label: string; value: string; icon?: LucideIcon; description?: string; summaryLabel?: string }[];
  get: () => string;
  set: (value: string) => string | void | Promise<string | void>;
  subscribe?: (cb: (value: string) => void) => () => void;
  successMessage?: string | ((value: string) => string);
  errorMessagePrefix?: string;
}

export interface MultiEnumSettingsItem extends SettingsItemBase {
  type: 'enum';
  multiSelect: true;
  enumStyle?: 'segmented' | 'select' | 'dialog';
  controlTestId?: string;
  optionTestId?: (value: string, index: number) => string | undefined;
  dialogTitle?: string;
  dialogDescription?: string;
  options: { label: string; value: string; icon?: LucideIcon; description?: string; summaryLabel?: string }[];
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
  dialogFieldKind?: 'plain' | 'secret';
  dialogInputType?: 'text' | 'url';
  dialogFooterStart?: { type: 'text'; text: string } | { type: 'secret-toggle'; showLabel: string; hideLabel: string };
  dialogFooterEnd?: string;
  allowClear?: boolean;
  clearSuccessMessage?: string | ((value: string) => string);
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
  groupStyle?: 'adaptive-overlay';
  dialogTitle?: string;
  dialogDescription?: string;
  children: SettingsItem[];
}

// AGENT GUIDE: `custom` is the escape hatch of last resort. Prefer extending the shared families above instead.
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
