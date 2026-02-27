import { ChevronRight, Globe, Heart, Package, Shield } from 'lucide-react';
import { Divider, SectionCard, SectionTitle, SettingRow } from './settings-shared';

export function AboutSection({
  appVersion,
  buildHash,
  onOpenOfficialWebsite,
  onOpenSponsor,
  onOpenLegalSupport,
}: {
  appVersion: string;
  buildHash: string;
  onOpenOfficialWebsite: () => void;
  onOpenSponsor: () => void;
  onOpenLegalSupport: () => void;
}) {
  return (
    <section className="space-y-2">
      <SectionTitle>关于</SectionTitle>
      <SectionCard>
        <SettingRow
          icon={<Globe className="h-[18px] w-[18px] text-[#78716C]" />}
          label="官网"
          onClick={onOpenOfficialWebsite}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<Heart className="h-[18px] w-[18px] text-[#78716C]" />}
          label="赞助开发者"
          onClick={onOpenSponsor}
          right={
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#A8A29E]">Starlin</span>
              <ChevronRight className="h-4 w-4 text-[#A8A29E]" />
            </div>
          }
        />
        <Divider />
        <SettingRow
          icon={<Shield className="h-[18px] w-[18px] text-[#78716C]" />}
          label="法律与支持"
          onClick={onOpenLegalSupport}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
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
      </SectionCard>
    </section>
  );
}
