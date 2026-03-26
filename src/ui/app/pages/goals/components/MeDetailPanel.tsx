import { DetailPanelShell } from './DetailPanelShell';

interface MeDetailPanelProps {
  name: string;
  goalsCount: number;
  onClose: () => void;
}

export function MeDetailPanel({ name, goalsCount, onClose }: MeDetailPanelProps) {
  return (
    <DetailPanelShell title={name} subtitle="Me" onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-2xl bg-[#FAF7F5] px-4 py-3 text-sm text-[#57534E] dark:bg-[#120F0D] dark:text-[#D6D3D1]">
          这里是你的目标网络起点。当前共有 {goalsCount} 个目标节点。
        </p>
      </div>
    </DetailPanelShell>
  );
}
