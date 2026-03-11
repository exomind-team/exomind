import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { DESKTOP_TAB_CONFIG } from '@/ui/app/config/settings/desktop-tab-config';
import type { SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

const SECTION_TEST_IDS: Record<string, string> = {
  appearance: 'new-settings-desktop-vc-section-theme',
  focus: 'new-settings-desktop-vc-section-focus',
  input: 'new-settings-desktop-vc-section-input',
  services: 'new-settings-desktop-vc-section-services',
  data: 'new-settings-desktop-vc-section-data',
  developer: 'new-settings-desktop-vc-section-developer',
  danger: 'new-settings-desktop-vc-section-danger',
};

export function DesktopSettingsLayout({
  items,
  ctx,
  aboutContent,
}: {
  items: SettingsItem[];
  ctx: SettingsContext;
  aboutContent?: ReactNode;
}) {
  const tabs = useMemo(
    () => DESKTOP_TAB_CONFIG.filter((tab) => items.some((item) => tab.categories.includes(item.category))),
    [items],
  );
  const [activeTab, setActiveTab] = useState(tabs[0]?.key ?? 'appearance');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (tabs.some((tab) => tab.key === activeTab)) {
      return;
    }
    setActiveTab(tabs[0]?.key ?? 'appearance');
  }, [activeTab, tabs]);

  const renderSection = (tabKey: string) => {
    const tab = tabs.find((entry) => entry.key === tabKey);
    if (!tab) {
      return null;
    }

    const tabItems = items.filter((item) => tab.categories.includes(item.category));
    if (tabItems.length === 0) {
      return null;
    }

    return (
      <SettingsSection
        key={tab.key}
        title={tab.label}
        testId={SECTION_TEST_IDS[tab.key] ?? `new-settings-desktop-vc-section-${tab.key}`}
      >
        <div ref={(node) => {
          sectionRefs.current[tab.key] = node;
        }}>
          {tabItems.map((item) => (
            <SettingsItemRenderer key={item.id} item={item} ctx={ctx} />
          ))}
        </div>
      </SettingsSection>
    );
  };

  const orderedSections = tabs
    .filter((tab) => tab.key !== 'danger')
    .map((tab) => renderSection(tab.key));

  const dangerSection = renderSection('danger');

  return (
    <div data-testid="new-settings-desktop-vc-root" className="space-y-6">
      <div className="inline-flex items-center gap-1 rounded-lg bg-[#F5F0ED] p-1 dark:bg-[#292524]" data-testid="new-settings-desktop-vc-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={activeTab === tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              sectionRefs.current[tab.key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="rounded-md px-3 py-1.5 text-xs"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div data-testid="new-settings-desktop-vc-scroll" className="space-y-6">
        {orderedSections}
        {aboutContent ? (
          <section data-testid="new-settings-desktop-vc-section-about" className="space-y-5">
            {aboutContent}
          </section>
        ) : null}
        {dangerSection}
      </div>
    </div>
  );
}
