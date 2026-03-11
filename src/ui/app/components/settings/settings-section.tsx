import type { ReactNode } from 'react';

export function SettingsSection({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="space-y-2">
      <p className="text-[13px] font-medium leading-[1.4] text-[#78716C]">{title}</p>
      <div className="overflow-hidden rounded-2xl border border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
        {children}
      </div>
    </section>
  );
}
