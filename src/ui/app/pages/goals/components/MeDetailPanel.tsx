import { useEffect, useState } from 'react';
import { DetailPanelShell } from './DetailPanelShell';

interface MeDetailPanelProps {
  name: string;
  goalsCount: number;
  onClose: () => void;
  onUpdate: (name: string) => boolean;
}

export function MeDetailPanel({ name, goalsCount, onClose, onUpdate }: MeDetailPanelProps) {
  const [draftName, setDraftName] = useState(name);

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  return (
    <DetailPanelShell title={name} subtitle="Me" onClose={onClose}>
      <div className="space-y-4">
        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">名称</label>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => {
              const nextValue = draftName.trim();
              const normalized = nextValue || 'Me';
              if (normalized !== name && !onUpdate(normalized)) {
                setDraftName(name);
              }
              if (!nextValue) {
                setDraftName(normalized);
              }
            }}
            className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#1C1917] dark:border-[#3F3F46] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
          />
        </section>

        <p className="rounded-2xl bg-[#FAF7F5] px-4 py-3 text-sm text-[#57534E] dark:bg-[#120F0D] dark:text-[#D6D3D1]">
          这里是你的目标网络起点。当前共有 {goalsCount} 个目标节点。
        </p>
      </div>
    </DetailPanelShell>
  );
}
