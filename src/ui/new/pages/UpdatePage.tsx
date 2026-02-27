import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  RefreshCw,
  Download,
  Clock,
  Radio,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useUpdateStore } from '@/ui/stores/update-store';
import { getCurrentVersion, downloadUpdate } from '@/lib/services/update.service';
import type { CheckInterval } from '@/lib/services/update.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number | null): string {
  if (!ts) return '从未检查';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const INTERVAL_LABELS: Record<CheckInterval, string> = {
  hourly: '每小时',
  '6h': '每 6 小时',
  daily: '每天',
  manual: '手动',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UpdatePage() {
  const navigate = useNavigate();

  const channel = useUpdateStore((s) => s.channel);
  const checkInterval = useUpdateStore((s) => s.checkInterval);
  const autoDownloadPreview = useUpdateStore((s) => s.autoDownloadPreview);
  const updateAvailable = useUpdateStore((s) => s.updateAvailable);
  const lastCheckTime = useUpdateStore((s) => s.lastCheckTime);
  const isChecking = useUpdateStore((s) => s.isChecking);
  const error = useUpdateStore((s) => s.error);

  const setChannel = useUpdateStore((s) => s.setChannel);
  const setCheckInterval = useUpdateStore((s) => s.setCheckInterval);
  const setAutoDownloadPreview = useUpdateStore((s) => s.setAutoDownloadPreview);
  const doCheckForUpdate = useUpdateStore((s) => s.checkForUpdate);

  const [currentVersion, setCurrentVersion] = useState('...');

  useEffect(() => {
    getCurrentVersion().then(setCurrentVersion);
  }, []);

  const handleDownload = () => {
    if (updateAvailable?.downloadUrl) {
      downloadUpdate(updateAvailable.downloadUrl);
    }
  };

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
        {/* 当前版本卡片 */}
        <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-stone-500 dark:text-stone-400">当前版本</p>
              <p className="text-xl font-bold text-stone-900 dark:text-stone-100 mt-0.5">
                v{currentVersion}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500">
                <Clock className="h-3.5 w-3.5" />
                <span>上次检查：{formatTime(lastCheckTime)}</span>
              </div>
            </div>
          </div>
        </section>

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
          <select
            value={checkInterval}
            onChange={(e) => setCheckInterval(e.target.value as CheckInterval)}
            className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C75B3A]/50 focus:border-[#C75B3A] transition-colors"
          >
            {(Object.keys(INTERVAL_LABELS) as CheckInterval[]).map((key) => (
              <option key={key} value={key}>
                {INTERVAL_LABELS[key]}
              </option>
            ))}
          </select>
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

        {/* 检查更新按钮 */}
        <button
          type="button"
          disabled={isChecking}
          onClick={doCheckForUpdate}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#C75B3A' }}
          onMouseEnter={(e) => {
            if (!isChecking) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#b5502f';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#C75B3A';
          }}
        >
          <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
          {isChecking ? '正在检查...' : '立即检查更新'}
        </button>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* 无更新提示 */}
        {!isChecking && !error && lastCheckTime && !updateAvailable && (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 p-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-700 dark:text-green-400">
              当前已是最新版本
            </p>
          </div>
        )}

        {/* 可用更新卡片 */}
        {updateAvailable && updateAvailable.hasUpdate && (
          <section className="rounded-xl border-2 border-[#C75B3A]/30 bg-white dark:bg-stone-900 p-4">
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 rounded-full p-1.5"
                style={{ backgroundColor: 'rgba(199, 91, 58, 0.1)' }}
              >
                <Radio className="h-4 w-4" style={{ color: '#C75B3A' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  新版本 v{updateAvailable.latestVersion}
                </p>
                {updateAvailable.publishedAt && (
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                    发布于 {new Date(updateAvailable.publishedAt).toLocaleDateString('zh-CN')}
                  </p>
                )}
                {updateAvailable.size && (
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                    大小：{formatSize(updateAvailable.size)}
                  </p>
                )}
              </div>
            </div>

            {updateAvailable.downloadUrl && (
              <button
                type="button"
                onClick={handleDownload}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: '#C75B3A' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#b5502f';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#C75B3A';
                }}
              >
                <Download className="h-4 w-4" />
                下载更新
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
