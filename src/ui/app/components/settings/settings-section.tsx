import type { CSSProperties, ReactNode } from 'react';
import { SettingsToneProvider, buildSettingsToneStyle } from '@/ui/app/components/settings-shared';

export function SettingsSection({
  title,
  children,
  testId,
  toneColor = null,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  toneColor?: string | null;
}) {
  const style = buildSettingsToneStyle(toneColor) as CSSProperties | undefined;

  return (
    <section data-testid={testId} className="space-y-2">
      <p className="text-[13px] font-medium leading-[1.4] text-[#78716C]">{title}</p>
      <SettingsToneProvider toneColor={toneColor}>
        <div
          data-settings-section-card="true"
          style={style}
          className={`overflow-hidden rounded-2xl border bg-white dark:bg-[#1C1917] ${
            toneColor
              ? 'border-[color:var(--settings-tone-color)] dark:border-[color:var(--settings-tone-color)]'
              : 'border-[#F0ECE8] dark:border-[#292524]'
          }`}
        >
          {children}
        </div>
      </SettingsToneProvider>
    </section>
  );
}
