import { useEffect, useState, useCallback } from 'react';
import { MigrationDialog } from './MigrationDialog';
import {
  detectLegacyData,
  detectRtIsEmpty,
  type LegacyDataSummary,
} from '@/lib/migration/legacy-migration-detector';
import {
  executeMigration,
  type MigrationAdapters,
  type MigrationProgress,
} from '@/lib/migration/legacy-migration-executor';
import {
  isMigrationCompleted,
  isMigrationSkipped,
  markMigrationCompleted,
  markMigrationSkipped,
} from '@/lib/migration/legacy-migration-flags';
import { setAllBackendModes } from '@/config/domain-backend-mode';
import { detectRuntime } from '@/lib/environment/bootstrap';
import { TauriEventLogStorageAdapter } from '@/lib/adapters/tauri-eventlog-storage';
import { TaskPouchAdapter } from '@/lib/adapters/task-pouch-adapter';
import { WebStorageAdapter } from '@/lib/adapters/web-storage';
import { EventLogRtAdapter } from '@/lib/adapters/eventlog-rt-adapter';
import { TaskRtAdapter } from '@/lib/adapters/task-rt-adapter';
import { appendRuntimeProfileScope } from '@/lib/adapters/runtime-profile-scope';
import { getSelectedRuntimeTarget } from '@/config/runtime-target';

// Legacy localStorage keys used by TimeBlockService via WebStorageAdapter
const TIME_BLOCKS_KEY = 'time_blocks';
const ACTIVE_BLOCK_KEY = 'active_block';

function buildRtBaseUrl(): string {
  const target = getSelectedRuntimeTarget();
  const host =
    target.host.includes(':') && !target.host.startsWith('[')
      ? `[${target.host}]`
      : target.host;
  return `http://${host}:${target.port}`;
}

export function MigrationDialogController() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<LegacyDataSummary | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (detectRuntime() !== 'tauri') {
      return;
    }
    if (isMigrationCompleted() || isMigrationSkipped()) {
      return;
    }

    void (async () => {
      try {
        const legacyEventLogAdapter = new TauriEventLogStorageAdapter();
        const legacyTaskAdapter = new TaskPouchAdapter();
        const legacyStorage = new WebStorageAdapter();

        const legacyReaders = {
          readLegacyEvents: () => legacyEventLogAdapter.listEvents(),
          readLegacyTasks: () => legacyTaskAdapter.listTasks(true),
          readLegacyCompletedBlocks: () =>
            legacyStorage.read<unknown[]>(TIME_BLOCKS_KEY).then((v) => v ?? []),
          readLegacyActiveBlock: () => legacyStorage.read<unknown>(ACTIVE_BLOCK_KEY),
        };

        const detectedSummary = await detectLegacyData(legacyReaders);
        if (!detectedSummary.hasAnyData) {
          return;
        }

        const rtEventLogAdapter = new EventLogRtAdapter();
        const rtTaskAdapter = new TaskRtAdapter();

        const rtReaders = {
          readRtEvents: () => rtEventLogAdapter.listEvents(),
          readRtTasks: () => rtTaskAdapter.listTasks(true),
          readRtCompletedBlocks: async () => {
            const baseUrl = buildRtBaseUrl();
            const url = `${baseUrl}${appendRuntimeProfileScope('/timeblocks')}`;
            const response = await fetch(url, {
              method: 'GET',
              headers: { Accept: 'application/json' },
            });
            if (!response.ok) return [];
            return response.json() as Promise<unknown[]>;
          },
          readRtActiveBlock: async () => {
            const baseUrl = buildRtBaseUrl();
            const url = `${baseUrl}${appendRuntimeProfileScope('/timeblocks/active')}`;
            const response = await fetch(url, {
              method: 'GET',
              headers: { Accept: 'application/json' },
            });
            if (response.status === 404) return null;
            if (!response.ok) return null;
            return response.json() as Promise<unknown>;
          },
        };

        const rtIsEmpty = await detectRtIsEmpty(rtReaders);
        if (!rtIsEmpty) {
          return;
        }

        setSummary(detectedSummary);
        setOpen(true);
      } catch {
        // Detection errors are silently ignored — don't block app startup
      }
    })();
  }, []);

  const handleMigrate = useCallback(async () => {
    if (!summary) return;

    setMigrating(true);
    setError(undefined);

    try {
      const legacyEventLogAdapter = new TauriEventLogStorageAdapter();
      const legacyTaskAdapter = new TaskPouchAdapter();
      const legacyStorage = new WebStorageAdapter();

      // Re-read legacy data at migration time to get the most up-to-date snapshot.
      // Detection and execution are separate reads — this is intentional (TOCTOU acknowledged).
      const adapters: MigrationAdapters = {
        readLegacyEvents: () => legacyEventLogAdapter.listEvents(),
        readLegacyTasks: () => legacyTaskAdapter.listTasks(true),
        readLegacyCompletedBlocks: () =>
          legacyStorage.read<unknown[]>(TIME_BLOCKS_KEY).then((v) => v ?? []),
        readLegacyActiveBlock: () => legacyStorage.read<unknown>(ACTIVE_BLOCK_KEY),

        importEventsToRt: async (events) => {
          const baseUrl = buildRtBaseUrl();
          const url = `${baseUrl}${appendRuntimeProfileScope('/eventlog/import/json')}`;
          const scopedUrl = new URL(url);
          scopedUrl.searchParams.set('strategy', 'merge');
          const response = await fetch(scopedUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(events),
          });
          if (!response.ok) {
            throw new Error(`Import events failed: ${response.status}`);
          }
        },

        importTasksToRt: async (tasks) => {
          const baseUrl = buildRtBaseUrl();
          const url = `${baseUrl}${appendRuntimeProfileScope('/tasks/import/json')}`;
          const scopedUrl = new URL(url);
          scopedUrl.searchParams.set('strategy', 'merge');
          const response = await fetch(scopedUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(tasks),
          });
          if (!response.ok) {
            throw new Error(`Import tasks failed: ${response.status}`);
          }
        },

        writeCompletedBlocksToRt: async (blocks) => {
          const baseUrl = buildRtBaseUrl();
          const url = `${baseUrl}${appendRuntimeProfileScope('/timeblocks')}`;
          const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(blocks),
          });
          if (!response.ok) {
            throw new Error(`Write completed blocks failed: ${response.status}`);
          }
        },

        writeActiveBlockToRt: async (block) => {
          const baseUrl = buildRtBaseUrl();
          const url = `${baseUrl}${appendRuntimeProfileScope('/timeblocks/active')}`;
          const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(block),
          });
          if (!response.ok) {
            throw new Error(`Write active block failed: ${response.status}`);
          }
        },
      };

      const result = await executeMigration(adapters, setProgress);

      if (result.success) {
        setAllBackendModes('rt-sqlite');
        markMigrationCompleted();
        setOpen(false);
        window.location.reload();
      } else {
        setAllBackendModes('legacy');
        setError(result.error ?? '迁移失败，请稍后重试');
      }
    } catch (err) {
      setAllBackendModes('legacy');
      setError(err instanceof Error ? err.message : '迁移失败，请稍后重试');
    } finally {
      setMigrating(false);
    }
  }, [summary]);

  const handleSkip = useCallback(() => {
    markMigrationSkipped();
    setAllBackendModes('legacy');
    setOpen(false);
    window.location.reload();
  }, []);

  // Error dismiss: don't mark as skipped (user didn't choose to skip, migration failed).
  // Next launch will re-detect and offer migration again (retry on next startup).
  const handleErrorDismiss = useCallback(() => {
    setAllBackendModes('legacy');
    setOpen(false);
  }, []);

  if (summary === null) {
    return null;
  }

  return (
    <MigrationDialog
      open={open}
      summary={summary}
      onMigrate={() => void handleMigrate()}
      onSkip={handleSkip}
      onErrorDismiss={handleErrorDismiss}
      migrating={migrating}
      progress={progress}
      error={error}
    />
  );
}
