import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';

describe('Hybrid identity sync coordinators（混合身份同步协调器）', () => {
  const taskCoordinatorPath = path.resolve('src/ui/app/components/TaskSyncCoordinator.tsx');
  const reminderCoordinatorPath = path.resolve('src/ui/app/components/ReminderSyncCoordinator.tsx');

  it('TaskSyncCoordinator uses remote sync key instead of currentUser', () => {
    const source = readFileSync(taskCoordinatorPath, 'utf-8');

    expect(source).toContain('resolveRemoteSyncKey');
    expect(source).not.toContain('buildRemoteDbUrl(syncServerUrl, currentUser)');
    expect(source).not.toContain('const currentUser = useSyncStore');
  });

  it('ReminderSyncCoordinator uses remote sync key instead of currentUser', () => {
    const source = readFileSync(reminderCoordinatorPath, 'utf-8');

    expect(source).toContain('resolveRemoteSyncKey');
    expect(source).not.toContain('buildReminderRemoteDbUrl(syncServerUrl, currentUser)');
    expect(source).not.toContain('const currentUser = useSyncStore');
  });
});
