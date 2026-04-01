import { useEffect, useRef } from 'react';
import { useSyncStore } from '@/ui/stores/sync-store';
import { RtDomainBackfillService, getRtDomainBackfillService } from '@/lib/services/rt-domain-backfill.service';
import { log } from '@/lib/logger';

const BACKFILL_INTERVAL_MS = 15_000;

export function RtDomainBackfillCoordinator(): null {
  const backfillServiceRef = useRef<RtDomainBackfillService>(getRtDomainBackfillService());
  const isLoggedIn = useSyncStore((state) => state.isLoggedIn);
  const activeProfileId = useSyncStore((state) => state.activeProfileId);

  useEffect(() => {
    if (!isLoggedIn || !activeProfileId) {
      return;
    }

    let cancelled = false;

    const runBackfill = async () => {
      try {
        await backfillServiceRef.current.backfillConfirmedPeers();
      } catch (error) {
        if (cancelled) return;
        log.warn(`[RtDomainBackfillCoordinator] backfill failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void runBackfill();
    const intervalId = window.setInterval(() => {
      void runBackfill();
    }, BACKFILL_INTERVAL_MS);

    const handleFocus = () => {
      void runBackfill();
    };
    const handleOnline = () => {
      void runBackfill();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [activeProfileId, isLoggedIn]);

  return null;
}
