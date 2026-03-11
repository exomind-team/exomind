import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import type { Category, SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

const MOBILE_CATEGORY_ORDER: Category[] = [
  'appearance',
  'timer',
  'input',
  'feedback',
  'ai',
  'sync',
  'data',
  'developer',
  'danger',
];

const CATEGORY_LABELS: Record<Category, string> = {
  appearance: '外观',
  timer: '计时器',
  input: '输入',
  feedback: '反馈',
  ai: 'AI 设置',
  sync: '同步',
  data: '数据',
  developer: '开发者',
  danger: '危险区域',
};

const CATEGORY_TEST_IDS: Partial<Record<Category, string>> = {
  input: 'new-settings-input-section',
  feedback: 'new-settings-feedback-section',
};

export function MobileSettingsLayout({
  items,
  ctx,
}: {
  items: SettingsItem[];
  ctx: SettingsContext;
}) {
  return (
    <div className="space-y-5">
      {MOBILE_CATEGORY_ORDER.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;

        return (
          <SettingsSection
            key={category}
            testId={CATEGORY_TEST_IDS[category]}
            title={CATEGORY_LABELS[category]}
          >
            {categoryItems.map((item) => (
              <SettingsItemRenderer key={item.id} item={item} ctx={ctx} />
            ))}
          </SettingsSection>
        );
      })}
    </div>
  );
}
