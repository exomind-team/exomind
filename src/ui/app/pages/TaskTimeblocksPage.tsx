import { ArrowLeft, Clock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { getTimeBlockService } from '@/lib/services';
import type { TimeBlock } from '@/lib/types/event';
import { TASKS_LAST_PATH_KEY, buildTasksMainSearch } from './task-route-memory';

interface DaySection {
  dateKey: string;
  label: string;
  blocks: TimeBlock[];
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return '今日';
  if (date.toDateString() === yesterday.toDateString()) return '昨日';

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(startTime: number, endTime: number): string {
  const diffMs = endTime - startTime;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h${remaining}min` : `${hours}h`;
}

function getDayRange(date: Date): { start: number; end: number } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return { start, end: start + 86_400_000 };
}

export function TaskTimeblocksPage() {
  const [allBlocks, setAllBlocks] = useState<TimeBlock[]>([]);
  const [loadedDays, setLoadedDays] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Persist path for route memory
  useEffect(() => {
    sessionStorage.setItem(TASKS_LAST_PATH_KEY, '/tasks/timeline');
  }, []);

  // Load all blocks once, then slice by day count
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setIsLoading(true);
      const blocks = await getTimeBlockService().loadTimeBlocks();
      if (!disposed) {
        setAllBlocks(blocks);
        setIsLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, []);

  // Compute visible sections based on loadedDays
  const daySections: DaySection[] = (() => {
    const today = new Date();
    const sections: DaySection[] = [];

    for (let i = 0; i < loadedDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const { start, end } = getDayRange(date);
      const dayBlocks = allBlocks.filter((b) => b.startTime >= start && b.startTime < end);
      sections.push({
        dateKey: date.toDateString(),
        label: formatDateLabel(date),
        blocks: dayBlocks.sort((a, b) => b.endTime - a.endTime),
      });
    }

    return sections;
  })();

  // Infinite scroll: load more days when sentinel enters viewport
  const loadMore = useCallback(() => {
    setLoadedDays((prev) => {
      const next = prev + 1;
      // Stop after 90 days
      if (next > 90) {
        setHasMore(false);
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' },
    );

    const sentinel = sentinelRef.current;
    if (sentinel) observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="task-timeblocks-page">
      <header className="flex items-center justify-between border-b border-[#F0ECE8] px-5 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <div className="inline-flex select-none items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <Link
            to="/tasks"
            search={buildTasksMainSearch()}
            onClick={() => sessionStorage.removeItem(TASKS_LAST_PATH_KEY)}
            className="inline-flex items-center gap-1 hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
          >
            <ArrowLeft size={14} />
            任务
          </Link>
          <span>/</span>
          <span className="inline-flex items-center gap-1">
            <Clock size={14} />
            时间块
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-24 md:px-8 lg:px-10">
        {isLoading ? (
          <p className="text-sm text-[#A8A29E]">加载中...</p>
        ) : (
          <div className="space-y-6">
            {daySections.map((section) => (
              <div key={section.dateKey}>
                <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{section.label}</p>
                {section.blocks.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {section.blocks.map((block) => (
                      <Link
                        key={block.id}
                        to="/tasks/block/$blockId"
                        params={{ blockId: block.startId ?? block.id }}
                        search={{ from: 'timeblocks' }}
                        className="block"
                      >
                        <article className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917] dark:hover:bg-[#292524]">
                          <div className="flex">
                            <div className="w-1 shrink-0 self-stretch bg-[#C75B3A]" />
                            <div className="min-w-0 flex-1 px-4 py-3">
                              <p className="text-[11px] font-medium text-[#A8A29E]">
                                {formatTime(block.startTime)} — {formatTime(block.endTime)}
                              </p>
                              <p className="mt-1 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{block.name}</p>
                              <div className="mt-1 flex items-center gap-2 text-xs text-[#A8A29E]">
                                <span>{formatDuration(block.startTime, block.endTime)}</span>
                              </div>
                              {block.note ? (
                                <p className="mt-1 text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                  {`💬 "${block.note}"`}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[#A8A29E]">无时间块</p>
                )}
              </div>
            ))}

            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={sentinelRef} className="py-4 text-center text-xs text-[#A8A29E]">
                加载更多...
              </div>
            )}
            {!hasMore && (
              <p className="py-4 text-center text-xs text-[#A8A29E]">已加载全部历史</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
