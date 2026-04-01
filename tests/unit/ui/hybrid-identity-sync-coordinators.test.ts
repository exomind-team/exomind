import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';

describe('Hybrid identity sync coordinators（混合身份同步协调器）', () => {
  const taskCoordinatorPath = path.resolve('src/ui/app/components/TaskSyncCoordinator.tsx');
  const reminderCoordinatorPath = path.resolve('src/ui/app/components/ReminderSyncCoordinator.tsx');

  it('TaskSyncCoordinator is retired after RT cutover（Task 旧同步协调器已退役）', () => {
    const source = readFileSync(taskCoordinatorPath, 'utf-8');

    expect(source).toContain('Legacy TaskSyncCoordinator has been retired');
    expect(source).not.toContain('resolveRemoteSyncKey');
  });

  it('ReminderSyncCoordinator is retired after RT cutover（Reminder 旧同步协调器已退役）', () => {
    const source = readFileSync(reminderCoordinatorPath, 'utf-8');

    expect(source).toContain('Legacy ReminderSyncCoordinator has been retired');
    expect(source).not.toContain('resolveRemoteSyncKey');
  });
});
