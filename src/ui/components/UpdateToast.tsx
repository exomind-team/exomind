import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpCircle, X } from 'lucide-react';
import { useUpdateStore } from '@/ui/stores/update-store';

/**
 * 非侵入式更新提示 Toast。
 * 固定在屏幕右下角（桌面）/ 底部（移动端），
 * 当检测到新版本时滑入显示。
 */
export function UpdateToast() {
  const navigate = useNavigate();
  const updateAvailable = useUpdateStore((s) => s.updateAvailable);
  const toastDismissed = useUpdateStore((s) => s.toastDismissed);
  const dismissToast = useUpdateStore((s) => s.dismissToast);

  const shouldShow =
    updateAvailable !== null &&
    updateAvailable.hasUpdate &&
    !toastDismissed;

  // 控制入场/出场动画
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (shouldShow) {
      setMounted(true);
      // 下一帧触发入场动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      // 等动画结束后卸载
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [shouldShow]);

  if (!mounted || !updateAvailable) return null;

  return (
    <div
      className={[
        // 定位：桌面右下角，移动端底部居中
        'fixed z-50',
        'bottom-4 right-4 left-auto',
        'sm:bottom-6 sm:right-6',
        'max-sm:left-4 max-sm:right-4',
        // 外观
        'flex items-center gap-3',
        'rounded-xl border px-4 py-3 shadow-lg',
        'bg-stone-900/95 border-stone-700 text-stone-100',
        'dark:bg-stone-900/95 dark:border-stone-700 dark:text-stone-100',
        'backdrop-blur-sm',
        // 动画
        'transition-all duration-300 ease-out',
        visible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-4 opacity-0',
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      {/* 图标 */}
      <ArrowUpCircle
        className="h-5 w-5 shrink-0 text-[#C75B3A]"
      />

      {/* 文本 */}
      <span className="flex-1 text-sm font-medium truncate">
        发现新版本 v{updateAvailable.latestVersion}
      </span>

      {/* 查看详情 */}
      <button
        type="button"
        className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-white transition-colors bg-[#C75B3A] hover:bg-[#b5502f]"
        onClick={() => {
          navigate({ to: '/settings/update' });
          dismissToast();
        }}
      >
        查看详情
      </button>

      {/* 关闭 */}
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-stone-400 hover:text-stone-200 transition-colors"
        aria-label="关闭更新提示"
        onClick={dismissToast}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
