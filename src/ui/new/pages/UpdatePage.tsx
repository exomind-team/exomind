import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { UpdateStatusCard } from '@/ui/new/components/UpdateStatusCard';
import { UpdateSettingsCard } from '@/ui/new/components/UpdateSettingsCard';

export function UpdatePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full bg-stone-50 dark:bg-stone-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-stone-800">
        <button
          type="button"
          onClick={() => navigate({ to: '/settings' })}
          className="p-1.5 rounded-lg text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          aria-label="返回设置"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          更新
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <UpdateStatusCard />
        <UpdateSettingsCard />
      </div>
    </div>
  );
}
