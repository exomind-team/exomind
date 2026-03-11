import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { Divider, SettingRow, buildSettingsToneStyle, useSettingsToneColor } from '@/ui/app/components/settings-shared';
import type {
  ActionSettingsItem,
  BooleanSettingsItem,
  CustomSettingsItem,
  EnumSettingsItem,
  GroupSettingsItem,
  NumberSettingsItem,
  SettingsContext,
  SettingsItem,
  StringSettingsItem,
} from '@/ui/app/config/settings/settings-types';

function useSettingState<T>(
  getValue: () => T,
  subscribe?: (listener: (value: T) => void) => () => void,
): [T, (value: T) => void, () => T] {
  const getValueRef = useRef(getValue);
  getValueRef.current = getValue;
  const [value, setValue] = useState<T>(() => getValueRef.current());

  useEffect(() => {
    if (!subscribe) {
      return;
    }
    return subscribe((nextValue) => {
      setValue(nextValue);
    });
  }, [subscribe]);

  return [value, setValue, () => getValueRef.current()];
}

function resolveMessage<T>(
  message: string | ((value: T) => string) | undefined,
  value: T,
): string | null {
  if (!message) {
    return null;
  }
  return typeof message === 'function' ? message(value) : message;
}

function formatErrorMessage(prefix: string | undefined, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return prefix ? `${prefix}：${message}` : message;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<T>).then === 'function';
}

const SETTINGS_TONE_RESOLVED_COLOR = 'var(--settings-tone-color, var(--settings-tone-default))';

function NoticeBlock({
  message,
  tone,
}: {
  message: string | null;
  tone: 'success' | 'error';
}) {
  if (!message) {
    return null;
  }

  return (
    <div className={`px-4 pb-3 text-xs ${tone === 'error' ? 'text-red-600' : 'text-[#78716C]'}`}>
      {message}
    </div>
  );
}

function renderRowIcon(Icon?: BooleanSettingsItem['icon']) {
  if (!Icon) {
    return undefined;
  }

  return <Icon className="h-[18px] w-[18px] text-[#78716C]" />;
}

function HelperBlock({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="pb-[14px] pl-[46px] pr-4">
      <span className="text-xs text-[#A8A29E]">{message}</span>
    </div>
  );
}

function SecondaryValue({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1 text-sm text-[#A8A29E]">
      <span>{value}</span>
      <ChevronRight className="h-4 w-4" />
    </div>
  );
}

function BooleanRenderer({ item }: { item: BooleanSettingsItem }) {
  const toneColor = useSettingsToneColor();
  const [value, setValue, getCurrent] = useSettingState(item.get, item.subscribe);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (nextValue: boolean) => {
    setNotice(null);
    setError(null);
    setValue(nextValue);

    try {
      const result = item.set(nextValue);
      if (isPromiseLike<boolean | void>(result)) {
        void result
          .then((resolved) => {
            const finalValue = typeof resolved === 'boolean' ? resolved : nextValue;
            setValue(finalValue);
            setNotice(resolveMessage(item.successMessage, finalValue));
          })
          .catch((nextError) => {
            setValue(getCurrent());
            setError(formatErrorMessage(item.errorMessagePrefix, nextError));
          });
        return;
      }

      const finalValue = typeof result === 'boolean' ? result : nextValue;
      setValue(finalValue);
      setNotice(resolveMessage(item.successMessage, finalValue));
    } catch (nextError) {
      setValue(getCurrent());
      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
    }
  };

  return (
    <div>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        right={(
          <Switch
            data-testid={item.controlTestId}
            checked={value}
            onCheckedChange={handleChange}
            style={{
              '--switch-checked-bg': SETTINGS_TONE_RESOLVED_COLOR,
              ...(buildSettingsToneStyle(toneColor) ?? {}),
            } as CSSProperties}
          />
        )}
      />
      <HelperBlock message={item.description ?? null} />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function buildInlineEnumShellClass(): string {
  return 'relative inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]';
}

function buildInlineEnumShapeClass(index: number, total: number): string {
  if (total <= 1) {
    return 'rounded-[10px]';
  }

  if (index === 0) {
    return 'rounded-l-[9px] rounded-r-none';
  }

  if (index === total - 1) {
    return 'rounded-r-[9px] rounded-l-none';
  }

  return 'rounded-none';
}

function buildSingleSelectInlineEnumButtonClass(selected: boolean): string {
  return `relative z-10 flex h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-[8px] text-[12px] transition-colors duration-200 ${
    selected
      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
      : 'text-[#78716C] hover:text-[#57534E] dark:text-[#A8A29E] dark:hover:text-[#D6D3D1]'
  }`;
}

function buildMultiSelectInlineEnumButtonClass(selected: boolean, index: number, total: number): string {
  return `relative z-10 flex h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap px-[8px] text-[12px] transition-colors duration-200 ${buildInlineEnumShapeClass(index, total)} ${
    selected
      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
      : 'text-[#78716C] hover:text-[#57534E] dark:text-[#A8A29E] dark:hover:text-[#D6D3D1]'
  }`;
}

function buildAdjacentSelectionShapeClass(index: number, total: number, selectedStates: boolean[]): string {
  if (total <= 1) {
    return 'rounded-[10px]';
  }

  const leftRounded = index === 0 || !selectedStates[index - 1];
  const rightRounded = index === total - 1 || !selectedStates[index + 1];

  if (leftRounded && rightRounded) {
    return 'rounded-[10px]';
  }

  return `${leftRounded ? 'rounded-l-[9px]' : 'rounded-l-none'} ${rightRounded ? 'rounded-r-[9px]' : 'rounded-r-none'}`;
}

function buildAdjacentSelectionBorderClass(index: number, total: number, selectedStates: boolean[]): string {
  if (total <= 1) {
    return '';
  }

  const mergeLeftEdge = index > 0 && selectedStates[index - 1];
  const mergeRightEdge = index < total - 1 && selectedStates[index + 1];

  return `${mergeLeftEdge ? 'border-l-0' : ''} ${mergeRightEdge ? 'border-r-0' : ''}`;
}

function buildInlineEnumOverlayClass(
  selected: boolean,
  shapeClass: string,
  borderClass = '',
): string {
  return `pointer-events-none absolute inset-0 overflow-hidden border settings-tone-border shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-opacity duration-200 ease-out ${shapeClass} ${borderClass} ${
    selected ? 'opacity-100' : 'opacity-0'
  }`;
}

function buildInlineEnumOverlayStyle(toneColor: string | null): CSSProperties | undefined {
  if (!toneColor) {
    return undefined;
  }

  return {
    ...(buildSettingsToneStyle(toneColor) ?? {}),
  };
}

function buildInlineEnumOverlayFillClass(): string {
  return 'absolute inset-0 settings-tone-fill';
}

function buildInlineEnumOverlayFillStyle(toneColor: string | null): CSSProperties | undefined {
  if (!toneColor) {
    return undefined;
  }

  return buildSettingsToneStyle(toneColor);
}

function buildDialogEnumOptionCardClass(hasDescription: boolean): string {
  return `settings-dialog-option-card relative w-full overflow-hidden rounded-xl text-left ${hasDescription ? 'px-4 py-3' : 'px-4 py-3 text-sm'}`;
}

function buildDialogEnumSelectionOverlayClass(selected: boolean): string {
  return `pointer-events-none absolute inset-0 overflow-hidden rounded-xl border settings-tone-border transition-opacity duration-200 ease-out ${
    selected ? 'opacity-100' : 'opacity-0'
  }`;
}

function resolveEnumOptionSummary(option: EnumSettingsItem['options'][number]): string {
  return option.summaryLabel ?? option.label;
}

function resolveDialogEnumSummary(item: EnumSettingsItem, value: string | string[]): string {
  if (!item.multiSelect) {
    return resolveEnumOptionSummary(
      item.options.find((option) => option.value === value) ?? { label: String(value), value: String(value) },
    );
  }

  const selectedValues = value as string[];
  const selectedLabels = item.options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => resolveEnumOptionSummary(option));

  return selectedLabels.length > 0 ? selectedLabels.join('、') : '未选择';
}

function renderEnumOptionContent(option: EnumSettingsItem['options'][number]) {
  const Icon = option.icon;
  return (
    <span className="relative z-10 flex items-center gap-1">
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      <span>{option.label}</span>
    </span>
  );
}

function resolveNextEnumValue(
  item: EnumSettingsItem,
  values: string[],
  optionValue: string,
  selected: boolean,
): string | string[] {
  if (!item.multiSelect) {
    return optionValue;
  }

  return selected
    ? values.filter((entry) => entry !== optionValue)
    : item.options
      .filter((candidate) => values.includes(candidate.value) || candidate.value === optionValue)
      .map((candidate) => candidate.value);
}

function SingleSelectInlineEnumButtons({
  item,
  value,
  onSelect,
}: {
  item: EnumSettingsItem;
  value: string;
  onSelect: (nextValue: string) => void;
}) {
  const toneColor = useSettingsToneColor();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const activeButton = optionRefs.current[value];
      if (!activeButton) {
        setIndicator((current) => (current.ready ? { left: 0, width: 0, ready: false } : current));
        return;
      }

      setIndicator({
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
        ready: true,
      });
    };

    updateIndicator();

    const frame = window.requestAnimationFrame(updateIndicator);
    window.addEventListener('resize', updateIndicator);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(updateIndicator);
      observer.observe(containerRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateIndicator);
      observer?.disconnect();
    };
  }, [item.options, value]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={item.label}
      data-testid={item.controlTestId}
      className={buildInlineEnumShellClass()}
    >
      <div
        data-active-indicator="true"
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-[10px] border settings-tone-border shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[transform,width,opacity] duration-200 ease-out ${
          indicator.ready ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          ...buildInlineEnumOverlayStyle(toneColor),
          width: `${indicator.width}px`,
          transform: `translateX(${indicator.left}px)`,
        }}
      >
        <div
          data-active-indicator-fill="true"
          aria-hidden
          className={buildInlineEnumOverlayFillClass()}
          style={buildInlineEnumOverlayFillStyle(toneColor)}
        />
      </div>
      {item.options.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              optionRefs.current[option.value] = node;
            }}
            data-testid={item.optionTestId?.(option.value, index)}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onSelect(option.value);
            }}
            className={buildSingleSelectInlineEnumButtonClass(selected)}
          >
            {renderEnumOptionContent(option)}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelectInlineEnumButtons({
  item,
  value,
  onSelect,
}: {
  item: EnumSettingsItem;
  value: string[];
  onSelect: (nextValue: string[]) => void;
}) {
  const toneColor = useSettingsToneColor();
  const selectedStates = item.options.map((option) => value.includes(option.value));

  return (
    <div
      role="group"
      aria-label={item.label}
      data-testid={item.controlTestId}
      className={buildInlineEnumShellClass()}
    >
      {item.options.map((option, index) => {
        const selected = value.includes(option.value);
        return (
          <button
            key={option.value}
            data-testid={item.optionTestId?.(option.value, index)}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onSelect(resolveNextEnumValue(item, value, option.value, selected) as string[]);
            }}
            className={buildMultiSelectInlineEnumButtonClass(selected, index, item.options.length)}
          >
            <span
              data-selection-overlay="true"
              aria-hidden
              className={buildInlineEnumOverlayClass(
                selected,
                buildAdjacentSelectionShapeClass(index, item.options.length, selectedStates),
                buildAdjacentSelectionBorderClass(index, item.options.length, selectedStates),
              )}
              style={buildInlineEnumOverlayStyle(toneColor)}
            >
              <span
                data-selection-fill="true"
                aria-hidden
                className={buildInlineEnumOverlayFillClass()}
                style={buildInlineEnumOverlayFillStyle(toneColor)}
              />
            </span>
            {renderEnumOptionContent(option)}
          </button>
        );
      })}
    </div>
  );
}

function DialogEnumRenderer({
  item,
  value,
  onSelect,
}: {
  item: EnumSettingsItem;
  value: string | string[];
  onSelect: (nextValue: string | string[]) => void;
}) {
  const toneColor = useSettingsToneColor();
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={resolveDialogEnumSummary(item, value)} />}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl" style={buildSettingsToneStyle(toneColor)}>
          <DialogHeader>
            <DialogTitle>{item.dialogTitle ?? item.label}</DialogTitle>
            <DialogDescription className={item.dialogDescription ? undefined : 'sr-only'}>
              {item.dialogDescription ?? `${item.label} 设置`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {item.options.map((option) => {
              const selected = item.multiSelect
                ? (value as string[]).includes(option.value)
                : value === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    const nextValue = item.multiSelect
                      ? resolveNextEnumValue(item, value as string[], option.value, selected)
                      : option.value;
                    onSelect(nextValue);
                    if (!item.multiSelect) {
                      setOpen(false);
                    }
                  }}
                  className={buildDialogEnumOptionCardClass(Boolean(option.description))}
                >
                  <span
                    data-selection-overlay="true"
                    aria-hidden
                    className={buildDialogEnumSelectionOverlayClass(selected)}
                    style={buildInlineEnumOverlayStyle(toneColor)}
                  >
                    <span
                      data-selection-fill="true"
                      aria-hidden
                      className={buildInlineEnumOverlayFillClass()}
                      style={buildInlineEnumOverlayFillStyle(toneColor)}
                    />
                  </span>
                  <span className="relative z-10 flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-[#1C1917] dark:text-[#FAFAF9]">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-xs text-[#A8A29E]">{option.description}</span>
                      ) : null}
                    </span>
                    {selected ? (
                      <Check
                        className="h-4 w-4 shrink-0"
                        style={{ color: SETTINGS_TONE_RESOLVED_COLOR }}
                      />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EnumRenderer({ item }: { item: EnumSettingsItem }) {
  const [value, setValue, getCurrent] = useSettingState(
    item.get as () => string | string[],
    item.subscribe as ((listener: (value: string | string[]) => void) => () => void) | undefined,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (nextValue: string | string[]) => {
    setNotice(null);
    setError(null);
    setValue(nextValue);

    try {
      const result = item.multiSelect ? item.set(nextValue as string[]) : item.set(nextValue as string);
      if (isPromiseLike<string | string[] | void>(result)) {
        void result
          .then((resolved) => {
            const finalValue = resolved !== undefined ? resolved as string | string[] : nextValue;
            setValue(finalValue);
            setNotice(resolveMessage(item.successMessage as ((value: string | string[]) => string) | string | undefined, finalValue));
          })
          .catch((nextError) => {
            setValue(getCurrent());
            setError(formatErrorMessage(item.errorMessagePrefix, nextError));
          });
        return;
      }

      const finalValue = result !== undefined ? result as string | string[] : nextValue;
      setValue(finalValue);
      setNotice(resolveMessage(item.successMessage as ((value: string | string[]) => string) | string | undefined, finalValue));
    } catch (nextError) {
      setValue(getCurrent());
      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
    }
  };

  const helperText = !item.multiSelect && item.helperText
    ? item.helperText(value as string)
    : null;

  if (item.enumStyle === 'dialog') {
    return (
      <div>
        <DialogEnumRenderer item={item} value={value} onSelect={handleChange} />
        <HelperBlock message={item.description ?? null} />
        <HelperBlock message={helperText} />
        <NoticeBlock message={notice} tone="success" />
        <NoticeBlock message={error} tone="error" />
      </div>
    );
  }

  if (item.enumStyle === 'select' && !item.multiSelect) {
    return (
      <div>
        <SettingRow
          testId={item.rowTestId}
          icon={renderRowIcon(item.icon)}
          label={item.label}
          right={(
            <select
              data-testid={item.controlTestId}
              aria-label={item.label}
              className="h-9 min-w-[186px] rounded-[10px] border border-[#E7E5E4] bg-white px-3 text-xs"
              value={value as string}
              onChange={(event) => {
                handleChange(event.target.value);
              }}
            >
              {item.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        />
        <HelperBlock message={item.description ?? null} />
        <HelperBlock message={helperText} />
        <NoticeBlock message={notice} tone="success" />
        <NoticeBlock message={error} tone="error" />
      </div>
    );
  }

  return (
    <div>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        right={item.multiSelect
          ? (
              <MultiSelectInlineEnumButtons
                item={item}
                value={value as string[]}
                onSelect={(nextValue) => handleChange(nextValue)}
              />
            )
          : (
              <SingleSelectInlineEnumButtons
                item={item}
                value={value as string}
                onSelect={(nextValue) => handleChange(nextValue)}
              />
            )}
      />
      <HelperBlock message={item.description ?? null} />
      <HelperBlock message={helperText} />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function NumberRenderer({ item }: { item: NumberSettingsItem }) {
  const toneColor = useSettingsToneColor();
  const [value, setValue, getCurrent] = useSettingState(item.get, item.subscribe);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (nextValue: number) => {
    setNotice(null);
    setError(null);
    setValue(nextValue);

    try {
      const result = item.set(nextValue);
      if (isPromiseLike<number | void>(result)) {
        void result
          .then((resolved) => {
            const finalValue = typeof resolved === 'number' ? resolved : nextValue;
            setValue(finalValue);
            setNotice(resolveMessage(item.successMessage, finalValue));
          })
          .catch((nextError) => {
            setValue(getCurrent());
            setError(formatErrorMessage(item.errorMessagePrefix, nextError));
          });
        return;
      }

      const finalValue = typeof result === 'number' ? result : nextValue;
      setValue(finalValue);
      setNotice(resolveMessage(item.successMessage, finalValue));
    } catch (nextError) {
      setValue(getCurrent());
      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
    }
  };

  const renderedValue = item.formatValue ? item.formatValue(value) : `${value}${item.unit ?? ''}`;

  return (
    <div>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        right={(
          <div className="flex min-w-[186px] items-center gap-3">
            <input
              data-testid={item.controlTestId}
              type="range"
              min={item.min}
              max={item.max}
              step={item.step}
              value={value}
              onChange={(event) => {
                handleChange(Number(event.target.value));
              }}
              style={{
                ...(buildSettingsToneStyle(toneColor) ?? {}),
                accentColor: SETTINGS_TONE_RESOLVED_COLOR,
              }}
              className="w-full"
            />
            <span className="min-w-[44px] text-right text-xs text-[#78716C]">
              {renderedValue}
            </span>
          </div>
        )}
      />
      <HelperBlock message={item.description ?? null} />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function maskStringValue(item: StringSettingsItem, value: string): string {
  if (!value) {
    return item.emptyValueLabel ?? item.placeholder ?? '未配置';
  }
  if (item.mask) {
    return item.mask(value);
  }
  if (!item.sensitive) {
    return value;
  }
  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function StringRenderer({ item }: { item: StringSettingsItem }) {
  const toneColor = useSettingsToneColor();
  const [value, setValue, getCurrent] = useSettingState(item.get, item.subscribe);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showSecret, setShowSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSecretDialog = item.dialogFieldKind === 'secret' || item.sensitive;

  const commitDialogValue = (
    nextValue: string,
    successMessageOverride?: string | ((value: string) => string),
  ) => {
    try {
      const result = item.set(nextValue);
      if (isPromiseLike<string | void>(result)) {
        void result
          .then((resolved) => {
            const finalValue = typeof resolved === 'string' ? resolved : nextValue;
            setValue(finalValue);
            setDraft(finalValue);
            setNotice(resolveMessage(successMessageOverride ?? item.successMessage, finalValue));
            setOpen(false);
            setShowSecret(false);
          })
          .catch((nextError) => {
            setValue(getCurrent());
            setError(formatErrorMessage(item.errorMessagePrefix, nextError));
          });
        return;
      }

      const finalValue = typeof result === 'string' ? result : nextValue;
      setValue(finalValue);
      setDraft(finalValue);
      setNotice(resolveMessage(successMessageOverride ?? item.successMessage, finalValue));
      setOpen(false);
      setShowSecret(false);
    } catch (nextError) {
      setValue(getCurrent());
      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
    }
  };

  const handleSave = () => {
    const validationMessage = item.validate?.(draft) ?? null;
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setError(null);
    commitDialogValue(draft);
  };

  const handleClear = () => {
    setError(null);
    commitDialogValue('', item.clearSuccessMessage ?? item.successMessage);
  };

  if (item.stringStyle !== 'dialog') {
    return (
      <div>
        <SettingRow
          testId={item.rowTestId}
          icon={renderRowIcon(item.icon)}
          label={item.label}
          right={(
            <input
              data-testid={item.controlTestId}
              aria-label={item.label}
              value={value}
              placeholder={item.placeholder}
              onChange={(event) => {
                const nextValue = event.target.value;
                setValue(nextValue);
                try {
                  const result = item.set(nextValue);
                  if (isPromiseLike<string | void>(result)) {
                    void result.catch((nextError) => {
                      setValue(getCurrent());
                      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
                    });
                  }
                } catch (nextError) {
                  setValue(getCurrent());
                  setError(formatErrorMessage(item.errorMessagePrefix, nextError));
                }
              }}
              className="h-9 min-w-[186px] rounded-[10px] border border-[#E7E5E4] px-3 text-xs"
            />
          )}
        />
        <HelperBlock message={item.description ?? null} />
        <NoticeBlock message={notice} tone="success" />
        <NoticeBlock message={error} tone="error" />
      </div>
    );
  }

  return (
    <div>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        onClick={() => {
          setDraft(value);
          setError(null);
          setShowSecret(false);
          setOpen(true);
        }}
        right={<SecondaryValue value={maskStringValue(item, value)} />}
      />
      <HelperBlock message={item.description ?? null} />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl" style={buildSettingsToneStyle(toneColor)}>
          <DialogHeader>
            <DialogTitle>{item.dialogTitle ?? item.label}</DialogTitle>
            <DialogDescription className={item.dialogDescription ? undefined : 'sr-only'}>
              {item.dialogDescription ?? `${item.label} 设置`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              data-testid={item.controlTestId}
              type={isSecretDialog ? (showSecret ? 'text' : 'password') : item.dialogInputType ?? 'text'}
              value={draft}
              placeholder={item.placeholder}
              onChange={(event) => setDraft(event.target.value)}
              className="settings-dialog-input"
            />
            {item.dialogFooterStart || item.dialogFooterEnd ? (
              <div
                className="settings-dialog-meta-row"
                data-align={item.dialogFooterStart && item.dialogFooterEnd ? 'between' : item.dialogFooterEnd ? 'end' : 'start'}
              >
                {item.dialogFooterStart ? (
                  item.dialogFooterStart.type === 'secret-toggle' ? (
                    <button
                      type="button"
                      onClick={() => setShowSecret((current) => !current)}
                      className="settings-dialog-meta-toggle"
                    >
                      {showSecret ? item.dialogFooterStart.hideLabel : item.dialogFooterStart.showLabel}
                    </button>
                  ) : (
                    <span className="settings-dialog-meta-text">{item.dialogFooterStart.text}</span>
                  )
                ) : null}
                {item.dialogFooterEnd ? (
                  <span className="settings-dialog-meta-text">{item.dialogFooterEnd}</span>
                ) : null}
              </div>
            ) : null}
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="settings-dialog-secondary-button flex-1">
                取消
              </button>
              {item.allowClear ? (
                <button type="button" onClick={handleClear} className="settings-dialog-secondary-button flex-1">
                  清空
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  handleSave();
                }}
                className="settings-dialog-primary-button flex-1"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionRenderer({ item }: { item: ActionSettingsItem }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const disabled = loading || (typeof item.disabled === 'function' ? item.disabled() : item.disabled);

  const handleAction = () => {
    const confirmFn = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm.bind(window)
      : typeof globalThis.confirm === 'function'
        ? globalThis.confirm.bind(globalThis)
        : undefined;

    if (item.confirmMessage && confirmFn && !confirmFn(item.confirmMessage)) {
      return;
    }

    setNotice(null);
    setError(null);
    try {
      const result = item.onAction();
      if (isPromiseLike<string | void>(result)) {
        setLoading(true);
        void result
          .then((resolved) => {
            setNotice(typeof resolved === 'string' ? resolved : item.successMessage ?? null);
          })
          .catch((nextError) => {
            setError(formatErrorMessage(item.errorMessagePrefix, nextError));
          })
          .finally(() => {
            setLoading(false);
          });
        return;
      }

      setNotice(typeof result === 'string' ? result : item.successMessage ?? null);
    } catch (nextError) {
      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
    }
  };

  if (item.actionMode === 'button') {
    return (
      <div data-testid={item.rowTestId}>
        <div className="flex items-center justify-between gap-3 px-4 py-[14px]">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{item.label}</p>
            {item.description ? (
              <p className="mt-1 text-xs text-[#A8A29E]">{item.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={disabled}
            title={item.disabledReason}
            onClick={() => {
              handleAction();
            }}
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: 'var(--settings-tone-color, #C75B3A)' }}
          >
            {item.buttonLabel ?? item.label}
          </button>
        </div>
        <NoticeBlock message={notice} tone="success" />
        <NoticeBlock message={error} tone="error" />
      </div>
    );
  }

  return (
    <div>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        onClick={() => {
          handleAction();
        }}
        disabled={disabled}
        title={item.disabledReason}
        right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <HelperBlock message={item.description ?? null} />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function GroupRenderer({
  item,
  ctx,
}: {
  item: GroupSettingsItem;
  ctx: SettingsContext;
}) {
  const toneColor = useSettingsToneColor();
  const [open, setOpen] = useState(false);

  const overlayMode = item.groupStyle ?? 'adaptive-overlay';
  const shouldUseDialog = overlayMode === 'adaptive-overlay' && Boolean(ctx.isLandscape);
  const contentTestId = `${item.id}-${shouldUseDialog ? 'dialog' : 'drawer'}-content`;
  const content = (
    <div
      data-testid={contentTestId}
      style={buildSettingsToneStyle(toneColor)}
      className="px-5 pb-8 pt-2"
    >
      <div className="mt-4 overflow-hidden rounded-2xl border settings-tone-border bg-white dark:border-[#FFFFFF15] dark:bg-[#1C1917]">
        {item.children.map((childItem, index) => (
          <div key={childItem.id}>
            <SettingsItemRenderer item={childItem} ctx={ctx} />
            {index < item.children.length - 1 ? <Divider toneColor={toneColor} /> : null}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <SettingRow
        testId={item.rowTestId}
        icon={renderRowIcon(item.icon)}
        label={item.label}
        onClick={() => setOpen(true)}
        right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <HelperBlock message={item.description ?? null} />
      {shouldUseDialog ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="rounded-2xl" style={buildSettingsToneStyle(toneColor)}>
            <DialogHeader>
              <DialogTitle>{item.dialogTitle ?? item.label}</DialogTitle>
              <DialogDescription className={item.dialogDescription ? undefined : 'sr-only'}>
                {item.dialogDescription ?? `${item.label} 设置`}
              </DialogDescription>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="dark:bg-[#1C1917]">
            <DrawerHeader className="pb-0 text-center">
              <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                {item.dialogTitle ?? item.label}
              </DrawerTitle>
              {item.dialogDescription ? (
                <DrawerDescription className="text-xs text-[#A8A29E]">
                  {item.dialogDescription}
                </DrawerDescription>
              ) : null}
            </DrawerHeader>
            {content}
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

function CustomRenderer({
  item,
  ctx,
}: {
  item: CustomSettingsItem;
  ctx: SettingsContext;
}) {
  const Component = item.component;
  return <Component ctx={ctx} />;
}

export function SettingsItemRenderer({
  item,
  ctx,
}: {
  item: SettingsItem;
  ctx: SettingsContext;
}) {
  switch (item.type) {
    case 'boolean':
      return <BooleanRenderer item={item} />;
    case 'enum':
      return <EnumRenderer item={item} />;
    case 'number':
      return <NumberRenderer item={item} />;
    case 'string':
      return <StringRenderer item={item} />;
    case 'action':
      return <ActionRenderer item={item} />;
    case 'group':
      return <GroupRenderer item={item} ctx={ctx} />;
    case 'custom':
      return <CustomRenderer item={item} ctx={ctx} />;
    default:
      return null;
  }
}
