import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { SettingsItemRow } from './settings-item-row';
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

function BooleanRenderer({ item }: { item: BooleanSettingsItem }) {
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
      <SettingsItemRow
        testId={item.rowTestId}
        label={item.label}
        description={item.description}
        control={(
          <Switch
            data-testid={item.controlTestId}
            checked={value}
            onCheckedChange={handleChange}
          />
        )}
      />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function buildSegmentedClass(index: number, total: number, selected: boolean): string {
  const shapeClass = index === 0
    ? 'rounded-l-xl rounded-r-none'
    : index === total - 1
      ? 'rounded-r-xl rounded-l-none'
      : 'rounded-none';

  const colorClass = selected
    ? 'border-[#C75B3A] bg-[#FFF1EB] text-[#C75B3A]'
    : 'border-[#E7E5E4] bg-white text-[#78716C]';

  return `${shapeClass} border px-2.5 py-1.5 text-xs ${colorClass}`;
}

function EnumButtons({
  item,
  value,
  onSelect,
}: {
  item: EnumSettingsItem;
  value: string | string[];
  onSelect: (nextValue: string | string[]) => void;
}) {
  const values = Array.isArray(value) ? value : [value];

  return (
    <div role="group" aria-label={item.label} className="flex items-center gap-0">
      {item.options.map((option, index) => {
        const selected = values.includes(option.value);
        return (
          <button
            key={option.value}
            data-testid={item.optionTestId?.(option.value, index)}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (item.multiSelect) {
                const nextValues = selected
                  ? values.filter((entry) => entry !== option.value)
                  : item.options
                    .filter((candidate) => values.includes(candidate.value) || candidate.value === option.value)
                    .map((candidate) => candidate.value);
                onSelect(nextValues);
                return;
              }

              onSelect(option.value);
            }}
            className={buildSegmentedClass(index, item.options.length, selected)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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

  if (item.enumStyle === 'select' && !item.multiSelect) {
    return (
      <div>
        <SettingsItemRow
          testId={item.rowTestId}
          label={item.label}
          description={item.description}
          control={(
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
        {helperText ? <div className="px-4 pb-3 text-xs text-[#78716C]">{helperText}</div> : null}
        <NoticeBlock message={notice} tone="success" />
        <NoticeBlock message={error} tone="error" />
      </div>
    );
  }

  return (
    <div>
      <SettingsItemRow
        testId={item.rowTestId}
        label={item.label}
        description={item.description}
        control={<EnumButtons item={item} value={value} onSelect={(nextValue) => handleChange(nextValue)} />}
      />
      {helperText ? <div className="px-4 pb-3 text-xs text-[#78716C]">{helperText}</div> : null}
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function NumberRenderer({ item }: { item: NumberSettingsItem }) {
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
      <SettingsItemRow
        testId={item.rowTestId}
        label={item.label}
        description={item.description}
        control={(
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
              className="w-full accent-[#C75B3A]"
            />
            <span className="min-w-[44px] text-right text-xs text-[#78716C]">
              {renderedValue}
            </span>
          </div>
        )}
      />
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
  const [value, setValue, getCurrent] = useSettingState(item.get, item.subscribe);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const validationMessage = item.validate?.(draft) ?? null;
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setError(null);

    try {
      const result = item.set(draft);
      if (isPromiseLike<string | void>(result)) {
        void result
          .then((resolved) => {
            const finalValue = typeof resolved === 'string' ? resolved : draft;
            setValue(finalValue);
            setNotice(resolveMessage(item.successMessage, finalValue));
            setOpen(false);
          })
          .catch((nextError) => {
            setValue(getCurrent());
            setError(formatErrorMessage(item.errorMessagePrefix, nextError));
          });
        return;
      }

      const finalValue = typeof result === 'string' ? result : draft;
      setValue(finalValue);
      setNotice(resolveMessage(item.successMessage, finalValue));
      setOpen(false);
    } catch (nextError) {
      setValue(getCurrent());
      setError(formatErrorMessage(item.errorMessagePrefix, nextError));
    }
  };

  if (item.stringStyle !== 'dialog') {
    return (
      <div>
        <SettingsItemRow
          testId={item.rowTestId}
          label={item.label}
          description={item.description}
          control={(
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
        <NoticeBlock message={notice} tone="success" />
        <NoticeBlock message={error} tone="error" />
      </div>
    );
  }

  return (
    <div>
      <SettingsItemRow
        testId={item.rowTestId}
        label={item.label}
        description={item.description}
        onClick={() => {
          setDraft(value);
          setError(null);
          setOpen(true);
        }}
        control={(
          <div className="flex items-center gap-1 text-sm text-[#A8A29E]">
            <span>{maskStringValue(item, value)}</span>
            <ChevronRight className="h-4 w-4" />
          </div>
        )}
      />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{item.dialogTitle ?? item.label}</DialogTitle>
            <DialogDescription className={item.dialogDescription ? undefined : 'sr-only'}>
              {item.dialogDescription ?? `${item.label} 设置`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              data-testid={item.controlTestId}
              type={item.sensitive ? 'password' : 'text'}
              value={draft}
              placeholder={item.placeholder}
              onChange={(event) => setDraft(event.target.value)}
              className="h-10 w-full rounded-[10px] border border-[#E7E5E4] px-3 text-sm"
            />
            {error ? <div className="text-xs text-red-600">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSave();
                }}
                className="rounded-md bg-[#C75B3A] px-3 py-1.5 text-sm text-white"
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
    if (item.confirmMessage && !window.confirm(item.confirmMessage)) {
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

  return (
    <div>
      <button
        data-testid={item.rowTestId}
        type="button"
        disabled={disabled}
        title={item.disabledReason}
        onClick={() => {
          handleAction();
        }}
        className="flex w-full items-center justify-between px-4 py-[14px] text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{item.buttonLabel ?? item.label}</span>
        <ChevronRight className="h-4 w-4 text-[#A8A29E]" />
      </button>
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function GroupRenderer({ item }: { item: GroupSettingsItem }) {
  return (
    <SettingsItemRow
      testId={item.rowTestId}
      label={item.label}
      description={item.description}
      control={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
    />
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
      return <GroupRenderer item={item} />;
    case 'custom':
      return <CustomRenderer item={item} ctx={ctx} />;
    default:
      return null;
  }
}
