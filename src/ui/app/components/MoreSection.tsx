import {
  Bug,
  ChevronRight,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Activity,
} from 'lucide-react';
import { Divider, SectionCard, SectionTitle, SettingRow } from './settings-shared';

export function MoreSection({
  onNavigateUpdate,
  onComingSoon,
}: {
  onNavigateUpdate: () => void;
  onComingSoon: () => void;
}) {
  return (
    <section className="space-y-2">
      <SectionTitle>更多</SectionTitle>
      <SectionCard>
        <SettingRow
          icon={<RefreshCw className="h-[18px] w-[18px] text-[#78716C]" />}
          label="更新"
          onClick={onNavigateUpdate}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<LifeBuoy className="h-[18px] w-[18px] text-[#78716C]" />}
          label="帮助中心"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<MessageSquare className="h-[18px] w-[18px] text-[#78716C]" />}
          label="反馈建议"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<Activity className="h-[18px] w-[18px] text-[#78716C]" />}
          label="遥测"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<Bug className="h-[18px] w-[18px] text-[#78716C]" />}
          label="报告问题"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
        <Divider />
        <SettingRow
          icon={<ScrollText className="h-[18px] w-[18px] text-[#78716C]" />}
          label="调试日志"
          onClick={onComingSoon}
          right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
        />
      </SectionCard>
    </section>
  );
}
