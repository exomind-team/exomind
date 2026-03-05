import { useEffect, useRef } from 'react';
import { resolveSyncServerUrl, SYNC_SERVER_URL_CHANGED_EVENT } from '@/config/port-env';
import { getTaskService } from '@/lib/services';
import { buildSyncErrorLog } from '@/lib/storage/sync-error';
import { buildRemoteDbUrl } from '@/lib/sync/remote-db-url';
import { useSyncStore } from '@/ui/stores/sync-store';
import { useState } from 'react';

export function TaskSyncCoordinator(): null {
  const taskServiceRef = useRef(getTaskService());
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
      void taskServiceRef.current.stopSync();
      return;
    }

    let cancelled = false;
    const remoteUrl = buildRemoteDbUrl(syncServerUrl, currentUser);

    void taskServiceRef.current.startSync(remoteUrl).catch((error) => {
      if (cancelled) return;
      const [message, payload] = buildSyncErrorLog('TaskSyncCoordinator', remoteUrl, error);
      console.error(message, payload);
    });

    return () => {
      cancelled = true;
      void taskServiceRef.current.stopSync();
    };
  }, [currentUser, isLoggedIn, syncServerUrl]);

  return null;
}
