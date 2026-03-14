export type MigrationDomain = 'eventlog' | 'task' | 'timeblock';

export interface MigrationProgress {
  domain: MigrationDomain;
  step: number;
  totalSteps: number;
  label: string;
}

export interface MigrationResult {
  success: boolean;
  migratedDomains: MigrationDomain[];
  error?: string;
}

export interface MigrationAdapters {
  readLegacyEvents: () => Promise<unknown[]>;
  readLegacyTasks: () => Promise<unknown[]>;
  readLegacyCompletedBlocks: () => Promise<unknown[]>;
  readLegacyActiveBlock: () => Promise<unknown | null>;
  importEventsToRt: (events: unknown[]) => Promise<void>;
  importTasksToRt: (tasks: unknown[]) => Promise<void>;
  writeCompletedBlocksToRt: (blocks: unknown[]) => Promise<void>;
  writeActiveBlockToRt: (block: unknown) => Promise<void>;
}

type ProgressCallback = (progress: MigrationProgress) => void;

const TOTAL_STEPS = 3;

export async function executeMigration(
  adapters: MigrationAdapters,
  onProgress?: ProgressCallback,
): Promise<MigrationResult> {
  const migratedDomains: MigrationDomain[] = [];

  try {
    // Step 1: eventlog
    onProgress?.({ domain: 'eventlog', step: 1, totalSteps: TOTAL_STEPS, label: '迁移事件日志' });
    const events = await adapters.readLegacyEvents();
    if (events.length > 0) {
      await adapters.importEventsToRt(events);
      migratedDomains.push('eventlog');
    }

    // Step 2: task
    onProgress?.({ domain: 'task', step: 2, totalSteps: TOTAL_STEPS, label: '迁移任务' });
    const tasks = await adapters.readLegacyTasks();
    if (tasks.length > 0) {
      await adapters.importTasksToRt(tasks);
      migratedDomains.push('task');
    }

    // Step 3: timeblock
    onProgress?.({ domain: 'timeblock', step: 3, totalSteps: TOTAL_STEPS, label: '迁移时间块' });
    const completedBlocks = await adapters.readLegacyCompletedBlocks();
    const activeBlock = await adapters.readLegacyActiveBlock();
    if (completedBlocks.length > 0 || activeBlock !== null) {
      if (completedBlocks.length > 0) {
        await adapters.writeCompletedBlocksToRt(completedBlocks);
      }
      if (activeBlock !== null) {
        await adapters.writeActiveBlockToRt(activeBlock);
      }
      migratedDomains.push('timeblock');
    }

    return { success: true, migratedDomains };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, migratedDomains, error };
  }
}
