import { useEffect, useState } from "react";

// ─── Mock 数据 / Mock Data ───────────────────────────────────────

interface ActionItem {
  id: string;
  title: string;
  status: "doing" | "next" | "done";
}

interface OneNotePreview {
  title: string;
  snippet: string;
  updatedAt: string;
}

const MOCK_ACTIONS: ActionItem[] = [
  { id: "1", title: "完善 AppBar PoC 接入", status: "doing" },
  { id: "2", title: "设计 action-dock 信息架构", status: "next" },
  { id: "3", title: "Graph API 读取 OneNote 笔记本列表", status: "next" },
];

const MOCK_ONENOTE_PAGES: OneNotePreview[] = [
  {
    title: "ExoMind 右侧栏设计思路",
    snippet: "AppBar 机制让其他最大化窗口自动避让...",
    updatedAt: "2026-07-15",
  },
  {
    title: "OneNote Graph API 调研笔记",
    snippet: "支持 CRUD + HTML 渲染，OAuth 认证流程...",
    updatedAt: "2026-07-14",
  },
  {
    title: "外心 dogfooding 路线",
    snippet: "语音→事件记录+任务推进，先服务「人掌控自己」...",
    updatedAt: "2026-07-13",
  },
];

// ─── Sub-components ──────────────────────────────────────────────

function StatusBadge({ status }: { status: ActionItem["status"] }) {
  const config: Record<ActionItem["status"], { label: string; className: string }> = {
    doing: {
      label: "进行中",
      className:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    },
    next: {
      label: "下一步",
      className:
        "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    },
    done: {
      label: "✓",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
  };
  const { label, className } = config[status];
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${className}`}>
      {label}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────

export function ActionDockPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className={`
        h-full w-full flex flex-col select-none
        bg-white dark:bg-neutral-900
        border-l border-neutral-200 dark:border-neutral-800
        transition-opacity duration-300
        ${mounted ? "opacity-100" : "opacity-0"}
      `}
    >
      {/* ── 上半区：ExoMind 行动区 / Upper: ExoMind Actions ── */}
      <section className="flex-1 flex flex-col min-h-0 border-b border-neutral-200 dark:border-neutral-800">
        <header className="shrink-0 px-4 pt-4 pb-2">
          <p className="text-[10px] font-semibold tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
            ExoMind · 当前行动
          </p>
        </header>

        <ul className="flex-1 overflow-y-auto px-4 space-y-1.5 pb-3">
          {MOCK_ACTIONS.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 py-1.5 px-2 rounded-md
                         hover:bg-neutral-50 dark:hover:bg-neutral-800/50
                         transition-colors cursor-default"
            >
              <StatusBadge status={item.status} />
              <span className="text-[13px] leading-snug text-neutral-800 dark:text-neutral-200">
                {item.title}
              </span>
            </li>
          ))}
        </ul>

        <footer className="shrink-0 px-4 pb-3 pt-1">
          <button
            type="button"
            onClick={() => {
              // 将来跳转到 ExoMind 主窗口的任务面板
              // Future: open task panel in ExoMind main window
            }}
            className="w-full text-center text-[11px] py-1.5 rounded-md
                       text-orange-600 dark:text-orange-400
                       hover:bg-orange-50 dark:hover:bg-orange-900/20
                       transition-colors font-medium"
          >
            + 添加行动
          </button>
        </footer>
      </section>

      {/* ── 下半区：OneNote 预览区 / Lower: OneNote Preview ── */}
      <section className="flex-1 flex flex-col min-h-0">
        <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
            OneNote · 最近笔记
          </p>
          <span className="text-[9px] text-purple-500 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded-full font-medium">
            Mock
          </span>
        </header>

        <ul className="flex-1 overflow-y-auto px-4 space-y-2 pb-3">
          {MOCK_ONENOTE_PAGES.map((page) => (
            <li
              key={page.title}
              className="py-2 px-2.5 rounded-md
                         hover:bg-purple-50 dark:hover:bg-purple-900/10
                         transition-colors cursor-default
                         border border-transparent hover:border-purple-100 dark:hover:border-purple-900/30"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="w-3 h-3 rounded-sm bg-purple-200 dark:bg-purple-800 flex items-center justify-center shrink-0">
                  <svg
                    className="w-2 h-2 text-purple-600 dark:text-purple-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5L21 3m0 0h-7.5M21 3v7.5m-9 3L4.5 21m0 0h7.5M4.5 21v-7.5" />
                  </svg>
                </div>
                <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300 truncate">
                  {page.title}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500 line-clamp-2 ml-4.5">
                {page.snippet}
              </p>
              <p className="text-[9px] text-neutral-300 dark:text-neutral-600 mt-1 ml-4.5">
                {page.updatedAt}
              </p>
            </li>
          ))}
        </ul>

        <footer className="shrink-0 px-4 pb-3 pt-1">
          <p className="text-[9px] text-neutral-300 dark:text-neutral-600 text-center leading-relaxed">
            将来通过 Microsoft Graph API 读取
            <br />
            OneNote 笔记本、分区、页面内容
          </p>
        </footer>
      </section>
    </div>
  );
}
