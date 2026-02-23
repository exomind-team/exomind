import type React from 'react';

export function SettingRow({
  icon,
  label,
  right,
  onClick,
  className = '',
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full items-center justify-between px-4 py-[14px] ${onClick ? 'active:bg-stone-50 dark:active:bg-stone-800' : ''} ${className}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{label}</span>
      </div>
      {right}
    </Wrapper>
  );
}

export function Divider() {
  return (
    <div className="px-4">
      <div className="h-px bg-[#F0ECE8] dark:bg-[#292524]" />
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
