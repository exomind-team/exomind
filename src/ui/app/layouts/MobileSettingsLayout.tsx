import { SettingsItemRenderer } from '@/ui/app/components/settings/settings-renderers';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider } from '@/ui/app/components/settings-shared';
import { SETTINGS_CATEGORY_TONE_COLORS } from '@/ui/app/config/settings/settings-section-config';
import type { Category, SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

const MOBILE_CATEGORY_ORDER: Category[] = [
  'appearance',
  'timer',
  'input',
  'voice',
  'feedback',
  'ai',
  'connection',
  'terminal-agent',
  'sync',
  'data',
  'developer',
  'more',
  'about',
  'danger',
];

const CATEGORY_LABELS: Record<Category, string> = {
  appearance: '外观',
  timer: '计时器',
  input: '输入',
  voice: '语音',
  feedback: '时间块反馈',
  ai: 'AI 设置',
  connection: '连接',
  'terminal-agent': '终端 Agent',
  sync: '同步',
  data: '数据',
  developer: '开发者',
  more: '更多',
  about: '关于',
  danger: '危险区域',
};

const CATEGORY_TEST_IDS: Partial<Record<Category, string>> = {
  input: 'new-settings-input-section',
  voice: 'new-settings-voice-section',
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
            toneColor={SETTINGS_CATEGORY_TONE_COLORS[category] ?? null}
          >
            {categoryItems.map((item, index) => (
              <div key={item.id}>
                <SettingsItemRenderer item={item} ctx={ctx} />
                {index < categoryItems.length - 1 ? <Divider toneColor={SETTINGS_CATEGORY_TONE_COLORS[category] ?? null} /> : null}
              </div>
            ))}
          </SettingsSection>
        );
      })}
    </div>
  );
}
