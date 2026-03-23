import type React from 'react';
import { createContext, useContext } from 'react';
import type { CSSProperties } from 'react';

const SettingsToneContext = createContext<string | null>(null);

export function SettingsToneProvider({
  toneColor,
  children,
}: {
  toneColor: string | null;
  children: React.ReactNode;
}) {
  return (
    <SettingsToneContext.Provider value={toneColor}>
      {children}
    </SettingsToneContext.Provider>
  );
}

export function useSettingsToneColor(): string | null {
  return useContext(SettingsToneContext);
}

export function buildSettingsToneStyle(toneColor: string | null): CSSProperties | undefined {
  if (!toneColor) {
    return undefined;
  }

  return {
    '--settings-tone-color': toneColor,
  } as CSSProperties;
}

export function SettingRow({
  icon,
  label,
  right,
  onClick,
  className = '',
  testId,
  disabled = false,
  title,
}: {
  icon?: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
  title?: string;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      data-testid={testId}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      title={title}
      className={`flex w-full items-center justify-between px-4 py-[14px] ${onClick ? 'active:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:active:bg-stone-800' : ''} ${className}`}
    >
      <div className="flex items-center gap-3">
        {icon ?? null}
        <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{label}</span>
      </div>
      {right}
    </Wrapper>
  );
}

export function Divider({
  toneColor = null,
}: {
  toneColor?: string | null;
}) {
  const toneStyle = buildSettingsToneStyle(toneColor);
  const style = toneStyle
    ? {
        ...toneStyle,
        backgroundColor: 'color-mix(in srgb, var(--settings-tone-color) 18%, transparent)',
      } as CSSProperties
    : undefined;

  return (
    <div className="px-4">
      <div
        style={style}
        className={`h-px ${toneColor ? 'bg-transparent' : 'bg-[#F0ECE8] dark:bg-[#292524]'}`}
      />
    </div>
  );
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-medium leading-[1.4] text-[#78716C]">{children}</p>
  );
}
