import { useUpdateStore } from '@/ui/stores/update-store';
import type { CheckInterval } from '@/lib/services/update.service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const INTERVAL_LABELS: Record<CheckInterval, string> = {
  hourly: '每小时',
  '6h': '每 6 小时',
  daily: '每天',
  manual: '手动',
};

export function UpdateSettingsCard() {
  const channel = useUpdateStore((s) => s.channel);
  const checkInterval = useUpdateStore((s) => s.checkInterval);
  const autoDownloadPreview = useUpdateStore((s) => s.autoDownloadPreview);

  const setChannel = useUpdateStore((s) => s.setChannel);
  const setCheckInterval = useUpdateStore((s) => s.setCheckInterval);
  const setAutoDownloadPreview = useUpdateStore((s) => s.setAutoDownloadPreview);

  return (
    <>
      {/* 更新通道 */}
      <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-3">
          更新通道
        </h2>
        <div className="space-y-2.5">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="radio"
              name="channel"
              checked={channel === 'release'}
              onChange={() => setChannel('release')}
              className="mt-0.5 accent-[#C75B3A]"
            />
            <div>
              <span className="text-sm font-medium text-stone-900 dark:text-stone-100 group-hover:text-[#C75B3A] transition-colors">
                稳定版 (release)
              </span>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                推荐 — 经过充分测试的正式版本
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="radio"
              name="channel"
              checked={channel === 'preview'}
              onChange={() => setChannel('preview')}
              className="mt-0.5 accent-[#C75B3A]"
            />
            <div>
              <span className="text-sm font-medium text-stone-900 dark:text-stone-100 group-hover:text-[#C75B3A] transition-colors">
                预览版 (preview)
              </span>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                最新功能，可能不稳定
              </p>
            </div>
          </label>
        </div>
      </section>

      {/* 检查频率 */}
      <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-3">
          检查频率
        </h2>
        <Select
          value={checkInterval}
          onValueChange={(value) => setCheckInterval(value as CheckInterval)}
        >
          <SelectTrigger
            aria-label="检查频率"
            className="w-full rounded-lg border-stone-300 bg-stone-50 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(INTERVAL_LABELS) as CheckInterval[]).map((key) => (
              <SelectItem key={key} value={key}>
                {INTERVAL_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* Preview 设置 — 仅 preview 通道显示 */}
      {channel === 'preview' && (
        <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                自动下载预览版更新
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                检测到新版本时自动开始下载
              </p>
            </div>
            <div
              role="switch"
              aria-checked={autoDownloadPreview}
              tabIndex={0}
              onClick={() => setAutoDownloadPreview(!autoDownloadPreview)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setAutoDownloadPreview(!autoDownloadPreview);
                }
              }}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                autoDownloadPreview ? 'bg-[#C75B3A]' : 'bg-stone-300 dark:bg-stone-600',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                  autoDownloadPreview ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </div>
          </label>
        </section>
      )}
    </>
  );
}
