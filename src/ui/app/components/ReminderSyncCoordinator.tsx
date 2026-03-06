import { useEffect, useRef, useState } from 'react';
import { resolveSyncServerUrl, SYNC_SERVER_URL_CHANGED_EVENT } from '@/config/port-env';
import { getReminderService } from '@/lib/services/reminder.service';
import { buildSyncErrorLog } from '@/lib/storage/sync-error';
import { buildRemoteDbUrl } from '@/lib/sync/remote-db-url';
import { useSyncStore } from '@/ui/stores/sync-store';

const REMINDER_REMOTE_DB_SUFFIX = 'reminders';

function buildReminderRemoteDbUrl(baseUrl: string, currentUser: string): string {
  return buildRemoteDbUrl(baseUrl, `${currentUser}__${REMINDER_REMOTE_DB_SUFFIX}`);
}

export function ReminderSyncCoordinator(): null {
  const reminderServiceRef = useRef(getReminderService());
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
      void reminderServiceRef.current.stopSync();
      return;
    }

    let cancelled = false;
    const remoteUrl = buildReminderRemoteDbUrl(syncServerUrl, currentUser);

    void reminderServiceRef.current.startSync(remoteUrl).catch((error) => {
      if (cancelled) return;
      const [message, payload] = buildSyncErrorLog('ReminderSyncCoordinator', remoteUrl, error);
      console.error(message, payload);
    });

    return () => {
      cancelled = true;
      void reminderServiceRef.current.stopSync();
    };
  }, [currentUser, isLoggedIn, syncServerUrl]);

  return null;
}
