import { useEffect, useState } from 'react';
import {
  RefreshCw,
  Download,
  Clock,
  Radio,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useUpdateStore } from '@/ui/stores/update-store';
import { getCurrentVersion, downloadUpdate } from '@/lib/services/update.service';

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

export function UpdateStatusCard() {
  const updateAvailable = useUpdateStore((s) => s.updateAvailable);
  const lastCheckTime = useUpdateStore((s) => s.lastCheckTime);
  const isChecking = useUpdateStore((s) => s.isChecking);
  const error = useUpdateStore((s) => s.error);
  const doCheckForUpdate = useUpdateStore((s) => s.checkForUpdate);

  const [currentVersion, setCurrentVersion] = useState('...');

  useEffect(() => {
    getCurrentVersion().then(setCurrentVersion);
  }, []);

  const handleDownload = async () => {
    if (updateAvailable?.downloadUrl) {
      try {
        await downloadUpdate(updateAvailable.downloadUrl, updateAvailable.sha256);
      } catch (err) {
        useUpdateStore.setState({
          error: err instanceof Error ? `下载更新失败：${err.message}` : '下载更新失败',
        });
      }
    }
  };

  return (
    <>
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

      {/* 检查更新按钮 */}
      <button
        type="button"
        disabled={isChecking}
        onClick={doCheckForUpdate}
        className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white transition-colors disabled:opacity-60 bg-[#C75B3A] hover:bg-[#b5502f]"
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
            <div className="mt-0.5 rounded-full p-1.5 bg-[#C75B3A]/10">
              <Radio className="h-4 w-4 text-[#C75B3A]" />
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
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors bg-[#C75B3A] hover:bg-[#b5502f]"
            >
              <Download className="h-4 w-4" />
              下载更新
            </button>
          )}
        </section>
      )}
    </>
  );
}
