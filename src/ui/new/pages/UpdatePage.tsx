import { ArrowLeft, Download, CheckCircle2, Info } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

const MOCK_VERSION = {
  current: '1.2.0',
  latest: '1.3.0',
  releaseDate: '2026-02-20',
  releaseNotes: [
    '新增设置页面迭代',
    '优化计时器体验',
    '修复若干已知问题',
  ],
};

export function UpdatePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-3">
        <button
          type="button"
          onClick={() => navigate({ to: '/settings' })}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#78716C] active:bg-black/5 dark:active:bg-white/5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">更新</h1>
      </header>

      <div className="space-y-5 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">
        {/* Notice Banner */}
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-sm text-amber-700 dark:text-amber-300">功能暂未上线，以下为测试数据展示</span>
        </div>

        {/* Current Version Card */}
        <section className="overflow-hidden rounded-2xl border border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
          <div className="flex items-center gap-3 px-4 py-[14px]">
            <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500" />
            <div>
              <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">当前版本</span>
              <span className="ml-2 text-sm text-[#A8A29E]">v{MOCK_VERSION.current}</span>
            </div>
          </div>
        </section>

        {/* Available Update Card */}
        <section className="overflow-hidden rounded-2xl border border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
          <div className="px-4 py-[14px]">
            <div className="flex items-center gap-3">
              <Download className="h-[18px] w-[18px] text-[#C75B3A]" />
              <div>
                <span className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">可用更新</span>
                <span className="ml-2 text-sm text-[#C75B3A]">v{MOCK_VERSION.latest}</span>
              </div>
            </div>
            <p className="mt-1 pl-[30px] text-xs text-[#A8A29E]">
              发布于 {MOCK_VERSION.releaseDate}
            </p>
          </div>

          <div className="border-t border-[#F0ECE8] px-4 py-3 dark:border-[#292524]">
            <p className="mb-2 text-xs font-medium text-[#78716C]">更新内容</p>
            <ul className="space-y-1">
              {MOCK_VERSION.releaseNotes.map((note) => (
                <li key={note} className="flex items-start gap-2 text-xs text-[#1C1917] dark:text-[#FAFAF9]">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C75B3A]" />
                  {note}
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-[#F0ECE8] px-4 py-3 dark:border-[#292524]">
            <button
              type="button"
              disabled
              className="w-full rounded-xl bg-[#C75B3A]/40 py-2.5 text-sm font-medium text-white"
            >
              暂不可用
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
