import { useEffect, useRef } from 'react';
import { resolveSyncServerUrl, SYNC_SERVER_URL_CHANGED_EVENT } from '@/config/port-env';
import { getTaskService } from '@/lib/services';
import { buildSyncErrorLog } from '@/lib/storage/sync-error';
import { buildRemoteDbUrl } from '@/lib/sync/remote-db-url';
import { resolveRemoteSyncKey, useSyncStore } from '@/ui/stores/sync-store';
import { useState } from 'react';
import { log } from '@/lib/logger';

export function TaskSyncCoordinator(): null {
  const taskServiceRef = useRef(getTaskService());
  const isLoggedIn = useSyncStore((state) => state.isLoggedIn);
  const remoteDbKey = useSyncStore((state) => resolveRemoteSyncKey(state.credentials));
  const legacySyncState = useSyncStore((state) => state.status.state);
  const legacySyncActive = legacySyncState === 'connected' || legacySyncState === 'syncing';
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
    if (!isLoggedIn || !remoteDbKey || !legacySyncActive) {
      void taskServiceRef.current.stopSync();
      return;
    }

    let cancelled = false;
    const remoteUrl = buildRemoteDbUrl(syncServerUrl, remoteDbKey);

    void taskServiceRef.current.startSync(remoteUrl).catch((error) => {
      if (cancelled) return;
      const [message, payload] = buildSyncErrorLog('TaskSyncCoordinator', remoteUrl, error);
      log.error(`${message} ${JSON.stringify(payload)}`);
    });

    return () => {
      cancelled = true;
      void taskServiceRef.current.stopSync();
    };
  }, [isLoggedIn, legacySyncActive, remoteDbKey, syncServerUrl]);

  return null;
}
