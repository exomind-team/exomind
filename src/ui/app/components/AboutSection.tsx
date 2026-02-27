import { Heart, Package } from 'lucide-react';
import { Divider, SectionCard, SectionTitle, SettingRow } from './settings-shared';

export function AboutSection({
  appVersion,
  buildHash,
}: {
  appVersion: string;
  buildHash: string;
}) {
  return (
    <section className="space-y-2">
      <SectionTitle>关于</SectionTitle>
      <SectionCard>
        <SettingRow
          icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
          label="版本"
          right={<span className="text-sm text-[#A8A29E]">{appVersion}</span>}
        />
        <Divider />
        <SettingRow
          icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
          label="构建"
          right={<span className="text-sm text-[#A8A29E]">{buildHash || '—'}</span>}
        />
        <Divider />
        <div className="px-4 pb-[14px] pt-[14px]">
          <div className="flex items-center gap-3">
            <Heart className="h-[18px] w-[18px] text-[#78716C]" />
            <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">开发者</span>
          </div>
          <p className="mt-1 pl-[30px] text-xs leading-[1.4] text-[#A8A29E]">
            ExoMind — 个人生命成长助手，探索生命与认知的本质。
          </p>
        </div>
      </SectionCard>
    </section>
  );
}
