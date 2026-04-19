import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { LegacyDataSummary } from '@/lib/migration/legacy-migration-detector';
import type { MigrationProgress } from '@/lib/migration/legacy-migration-executor';

export interface MigrationDialogProps {
  open: boolean;
  summary: LegacyDataSummary;
  onMigrate: () => void;
  onSkip: () => void;
  onErrorDismiss?: () => void;
  migrating?: boolean;
  progress?: MigrationProgress;
  error?: string;
}

export function MigrationDialog({
  open,
  summary,
  onMigrate,
  onSkip,
  onErrorDismiss,
  migrating = false,
  progress,
  error,
}: MigrationDialogProps) {
  const progressPercent =
    progress && progress.totalSteps > 0
      ? Math.round((progress.step / progress.totalSteps) * 100)
      : 0;
  const dismissErrorState = onErrorDismiss ?? onSkip;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          return;
        }
        if (error) {
          dismissErrorState();
        }
      }}
    >
      <DialogContent
        hideCloseButton
        className="max-h-[85vh] max-w-sm overflow-hidden sm:max-w-md dark:border-[#FFFFFF15] dark:bg-[rgba(28,25,23,0.92)]"
        onInteractOutside={(e) => {
          if (!error) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (!error && migrating) {
            e.preventDefault();
          }
        }}
      >
        {/* ── Error State ── */}
        {error ? (
          <>
            <DialogHeader>
              <DialogTitle>迁移失败</DialogTitle>
              <DialogDescription>
                迁移过程中遇到问题。当前不会回退到旧版存储，你可以稍后重新尝试迁移。
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
              <pre className="exomind-selectable whitespace-pre-wrap break-all font-mono">{error}</pre>
            </div>

            <DialogFooter className="mt-4 flex-shrink-0">
              <button
                type="button"
                onClick={dismissErrorState}
                className="w-full rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                关闭并稍后重试
              </button>
            </DialogFooter>
          </>
        ) : migrating ? (
          /* ── Migrating State ── */
          <>
            {/* Visually hidden title/description satisfies Radix Dialog accessibility requirement */}
            <DialogTitle className="sr-only">正在迁移数据</DialogTitle>
            <DialogDescription className="sr-only">数据迁移正在进行中，请稍候。</DialogDescription>

            <div className="flex flex-col gap-4 py-2">
              <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                正在迁移...{' '}
                {progress && (
                  <span className="text-[#78716C] dark:text-[#A8A29E]">
                    {progress.label}（{progress.step}/{progress.totalSteps}）
                  </span>
                )}
              </p>

              <div className="h-2 w-full overflow-hidden rounded-full bg-[#F0ECE8] dark:bg-[#292524]">
                <div
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="迁移进度"
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          /* ── Default State ── */
          <>
            <DialogHeader>
              <DialogTitle>检测到旧版数据</DialogTitle>
              <DialogDescription>
                系统检测到以下旧版数据可以迁移到新的本地存储格式：
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-1.5 rounded-lg border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-3 text-sm text-[#1C1917] dark:border-[#292524] dark:bg-[#1C1917]/40 dark:text-[#FAFAF9]">
              {summary.eventlogCount > 0 && (
                <li>
                  事件日志 — <span className="font-medium">{summary.eventlogCount}</span> 条
                </li>
              )}
              {summary.taskCount > 0 && (
                <li>
                  任务 — <span className="font-medium">{summary.taskCount}</span> 个
                </li>
              )}
              {(summary.timeblockCount > 0 || summary.hasActiveBlock) && (
                <li>
                  时间块 — <span className="font-medium">{summary.timeblockCount}</span> 个
                  {summary.hasActiveBlock && (
                    <span className="ml-1 text-[#78716C] dark:text-[#A8A29E]">
                      （含进行中 1）
                    </span>
                  )}
                </li>
              )}
            </ul>

            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
              迁移后，数据将统一存储在本地 SQLite 数据库中，原始数据将保留作为备份。
              当前已不再支持运行时回退到旧版存储；如果暂不迁移，本次只会关闭弹窗，稍后仍可重新发起迁移。
            </p>

            <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <button
                type="button"
                onClick={onSkip}
                className="mt-2 w-full rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] sm:mt-0 sm:w-auto dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
              >
                暂不迁移
              </button>
              <button
                type="button"
                onClick={onMigrate}
                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 sm:w-auto"
              >
                立即迁移
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
