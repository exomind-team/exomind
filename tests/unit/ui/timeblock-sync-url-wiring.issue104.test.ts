import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('timeblock sync coordinator wiring issue-104', () => {
  const coordinatorPath = path.resolve('src/ui/app/components/TimeBlockSyncCoordinator.tsx');
  const timeBlockWidgetPath = path.resolve('src/components/TimeBlockWidget.tsx');
  const focusTimerWidgetPath = path.resolve('src/ui/app/components/FocusTimerWidget.tsx');
  const coordinatorSource = readFileSync(coordinatorPath, 'utf-8');
  const timeBlockWidgetSource = readFileSync(timeBlockWidgetPath, 'utf-8');
  const focusTimerWidgetSource = readFileSync(focusTimerWidgetPath, 'utf-8');

  it('TimeBlockSyncCoordinator starts ECS sync without building legacy remote url', () => {
    expect(coordinatorSource).not.toContain('SYNC_SERVER_URL_CHANGED_EVENT');
    expect(coordinatorSource).not.toContain('resolveSyncServerUrl');
    expect(coordinatorSource).not.toContain('buildRemoteDbUrl');
    expect(coordinatorSource).not.toContain('6984');
    expect(coordinatorSource).toContain('timeBlockServiceRef.current.startSync()');
    expect(coordinatorSource).toContain('timeBlockServiceRef.current.stopSync()');
  });

  it('widgets no longer manage sync lifecycle directly', () => {
    expect(timeBlockWidgetSource).not.toContain('startSync(');
    expect(timeBlockWidgetSource).not.toContain('stopSync(');
    expect(focusTimerWidgetSource).not.toContain('startSync(');
    expect(focusTimerWidgetSource).not.toContain('stopSync(');
  });
});
