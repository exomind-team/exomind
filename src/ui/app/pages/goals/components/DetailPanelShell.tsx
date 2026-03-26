import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

interface DetailPanelShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export function DetailPanelShell({ title, subtitle, onClose, children }: DetailPanelShellProps) {
  const isDesktop = useIsDesktop();

  return (
    <aside
      className={
        isDesktop
          ? 'pointer-events-auto absolute right-4 top-4 bottom-24 z-20 w-[340px] overflow-hidden rounded-[28px] border border-[#E7E5E4] bg-white/95 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.2)] backdrop-blur dark:border-[#292524] dark:bg-[#1C1917]/95'
          : 'pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[72vh] overflow-hidden rounded-t-[28px] border border-b-0 border-[#E7E5E4] bg-white/95 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.25)] backdrop-blur dark:border-[#292524] dark:bg-[#1C1917]/95'
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-[#F0ECE8] px-5 py-4 dark:border-[#292524]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">{subtitle ?? '详情'}</p>
            <h2 className="mt-2 text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E7E5E4] text-[#78716C] transition-colors hover:bg-[#F5F0ED] dark:border-[#3F3F46] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </aside>
  );
}
