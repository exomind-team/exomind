import { useEffect, useRef, useState } from 'react';
import { resolveSyncServerUrl, SYNC_SERVER_URL_CHANGED_EVENT } from '@/config/port-env';
import { getTimeBlockService } from '@/lib/services';
import { buildSyncErrorLog } from '@/lib/storage/sync-error';
import { buildRemoteDbUrl } from '@/lib/sync/remote-db-url';
import { useSyncStore } from '@/ui/stores/sync-store';

export function TimeBlockSyncCoordinator(): null {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const isLoggedIn = useSyncStore((state) => state.isLoggedIn);
  const currentUser = useSyncStore((state) => state.currentUser);
  const [syncServerUrl, setSyncServerUrl] = useState(() =>
    resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>)
  );

  useEffect(() => {
    const refreshSyncServerUrl = () => {
      setSyncServerUrl(resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>));
    };

    refreshSyncServerUrl();
    window.addEventListener(SYNC_SERVER_URL_CHANGED_EVENT, refreshSyncServerUrl);
    return () => {
      window.removeEventListener(SYNC_SERVER_URL_CHANGED_EVENT, refreshSyncServerUrl);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !currentUser) {
      void timeBlockServiceRef.current.stopSync();
      return;
    }

    let cancelled = false;
    const remoteUrl = buildRemoteDbUrl(syncServerUrl, currentUser);

    void timeBlockServiceRef.current.startSync(remoteUrl).catch((error) => {
      if (cancelled) return;
      const [message, payload] = buildSyncErrorLog('TimeBlockSyncCoordinator', remoteUrl, error);
      console.error(message, payload);
    });

    return () => {
      cancelled = true;
      void timeBlockServiceRef.current.stopSync();
    };
  }, [currentUser, isLoggedIn, syncServerUrl]);

  return null;
}
