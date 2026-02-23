import {
  ChevronRight,
  Code,
  ExternalLink,
  FileText,
  Globe,
  Heart,
  Shield,
} from 'lucide-react';
import { Divider, SectionCard, SectionTitle, SettingRow } from './settings-shared';

export function LegalSection({ onComingSoon }: { onComingSoon: () => void }) {
  return (
    <section className="space-y-2">
      <SectionTitle>法律与支持</SectionTitle>
      <SectionCard>
        <SettingRow
          icon={<Shield className="h-[18px] w-[18px] text-[#78716C]" />}
          label="隐私政策"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<FileText className="h-[18px] w-[18px] text-[#78716C]" />}
          label="用户协议"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<Globe className="h-[18px] w-[18px] text-[#78716C]" />}
          label="官网"
          onClick={onComingSoon}
          right={<ExternalLink className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<Heart className="h-[18px] w-[18px] text-[#78716C]" />}
          label="赞助开发者"
          onClick={onComingSoon}
          right={<ExternalLink className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
          label="开源软件使用声明"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
      </SectionCard>
    </section>
  );
}
