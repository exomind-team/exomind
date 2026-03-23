import { useEffect, useRef } from 'react';
import { getTimeBlockService } from '@/lib/services';
import { useSyncStore } from '@/ui/stores/sync-store';
import { log } from '@/lib/logger';

export function TimeBlockSyncCoordinator(): null {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const isLoggedIn = useSyncStore((state) => state.isLoggedIn);
  const activeProfileId = useSyncStore((state) => state.activeProfileId);

  useEffect(() => {
    if (!isLoggedIn || !activeProfileId) {
      void timeBlockServiceRef.current.stopSync();
      return;
    }

    let cancelled = false;

    void timeBlockServiceRef.current.startSync().catch((error) => {
      if (cancelled) return;
      log.error(`[TimeBlockSyncCoordinator] ECS sync start failed ${JSON.stringify({ activeProfileId, error: error instanceof Error ? error.message : String(error) })}`);
    });

    return () => {
      cancelled = true;
      void timeBlockServiceRef.current.stopSync();
    };
  }, [activeProfileId, isLoggedIn]);

  return null;
}
