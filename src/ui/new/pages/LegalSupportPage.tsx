import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { LegalSection } from '@/ui/new/components/LegalSection';

export function LegalSupportPage() {
  const navigate = useNavigate();
  const [comingSoonVisible, setComingSoonVisible] = useState(false);
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showComingSoon = () => {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
    setComingSoonVisible(true);
    comingSoonTimer.current = setTimeout(() => setComingSoonVisible(false), 1500);
  };

  return (
    <div className="min-h-full bg-[#FAF7F5] px-5 pb-24 pt-6 dark:bg-[#0C0A09] md:px-10 md:pb-10 md:pt-8">
      <div className="mx-auto w-full max-w-[980px] space-y-6">
        <button
          type="button"
          onClick={() => navigate({ to: '/settings' })}
          className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回设置
        </button>

        <section className="space-y-1">
          <h1 className="text-[22px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">法律与支持</h1>
          <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">仅包含低频合规信息</p>
        </section>

        <LegalSection onComingSoon={showComingSoon} />
      </div>

      {comingSoonVisible && (
        <div className="fixed inset-x-0 bottom-28 z-50 flex justify-center">
          <div className="rounded-full bg-[#1C1917] px-4 py-2 text-sm text-white shadow-lg dark:bg-[#FAFAF9] dark:text-[#1C1917]">
            即将推出
          </div>
        </div>
      )}
    </div>
  );
}
