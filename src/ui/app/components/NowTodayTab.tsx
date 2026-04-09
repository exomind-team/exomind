import { useEffect, useState } from 'react';
import { getTodayPlannerService } from '@/lib/services';
import type { TodayPlannerSnapshot } from '@/lib/types/event';
import { NowTodayPlannerTimeline } from './NowTodayPlannerTimeline';

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function NowTodayTab() {
  const [plannerSnapshot, setPlannerSnapshot] = useState<TodayPlannerSnapshot | null>(null);
  const [plannerLoading, setPlannerLoading] = useState(true);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const todayDate = formatDateKey(now);

  useEffect(() => {
    const todayPlannerService = getTodayPlannerService();
    let disposed = false;

    const loadPlanner = async () => {
      setPlannerLoading(true);
      setPlannerError(null);
      try {
        const snapshot = await todayPlannerService.getTodayPlanner(todayDate);
        if (disposed) {
          return;
        }
        setPlannerSnapshot(snapshot);
      } catch (error) {
        if (disposed) {
          return;
        }
        setPlannerError(error instanceof Error ? error.message : '加载今日计划失败');
      } finally {
        if (!disposed) {
          setPlannerLoading(false);
        }
      }
    };

    void loadPlanner();
    return () => {
      disposed = true;
    };
  }, [todayDate]);

  useEffect(() => {
    const nextDayStart = new Date();
    nextDayStart.setHours(24, 0, 0, 0);
    const delay = Math.max(1, nextDayStart.getTime() - Date.now());
    const timerId = window.setTimeout(() => {
      setNow(new Date());
    }, delay);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [todayDate]);

  const refreshPlanner = async () => {
    const currentDate = formatDateKey(new Date());
    setPlannerError(null);
    const snapshot = await getTodayPlannerService().getTodayPlanner(currentDate);
    setPlannerSnapshot(snapshot);
    if (currentDate !== todayDate) {
      setNow(new Date());
    }
  };

  return (
    <div className="space-y-6">
      <NowTodayPlannerTimeline
        dateKey={todayDate}
        snapshot={plannerSnapshot}
        loading={plannerLoading}
        error={plannerError}
        setError={setPlannerError}
        refreshPlanner={refreshPlanner}
      />
    </div>
  );
}
