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

  it('TimeBlockSyncCoordinator listens to sync server url changes and rebuilds remote url', () => {
    expect(coordinatorSource).toContain('SYNC_SERVER_URL_CHANGED_EVENT');
    expect(coordinatorSource).toContain('window.addEventListener(SYNC_SERVER_URL_CHANGED_EVENT');
    expect(coordinatorSource).toContain('window.removeEventListener(SYNC_SERVER_URL_CHANGED_EVENT');
    expect(coordinatorSource).toContain('buildRemoteDbUrl(syncServerUrl, currentUser)');
    expect(coordinatorSource).toContain('timeBlockServiceRef.current.startSync(remoteUrl)');
    expect(coordinatorSource).toContain('timeBlockServiceRef.current.stopSync()');
  });

  it('widgets no longer manage sync lifecycle directly', () => {
    expect(timeBlockWidgetSource).not.toContain('startSync(');
    expect(timeBlockWidgetSource).not.toContain('stopSync(');
    expect(focusTimerWidgetSource).not.toContain('startSync(');
    expect(focusTimerWidgetSource).not.toContain('stopSync(');
  });
});
