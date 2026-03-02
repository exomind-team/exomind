import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('timeblock widgets sync-server-url wiring issue-104', () => {
  const timeBlockWidgetPath = path.resolve('src/components/TimeBlockWidget.tsx');
  const focusTimerWidgetPath = path.resolve('src/ui/app/components/FocusTimerWidget.tsx');
  const timeBlockWidgetSource = readFileSync(timeBlockWidgetPath, 'utf-8');
  const focusTimerWidgetSource = readFileSync(focusTimerWidgetPath, 'utf-8');

  it('TimeBlockWidget listens to sync server url changes and rebuilds remote url', () => {
    expect(timeBlockWidgetSource).toContain('SYNC_SERVER_URL_CHANGED_EVENT');
    expect(timeBlockWidgetSource).toContain('window.addEventListener(SYNC_SERVER_URL_CHANGED_EVENT');
    expect(timeBlockWidgetSource).toContain('window.removeEventListener(SYNC_SERVER_URL_CHANGED_EVENT');
    expect(timeBlockWidgetSource).toContain('buildRemoteDbUrl(syncServerUrl, currentUser)');
  });

  it('FocusTimerWidget listens to sync server url changes and rebuilds remote url', () => {
    expect(focusTimerWidgetSource).toContain('SYNC_SERVER_URL_CHANGED_EVENT');
    expect(focusTimerWidgetSource).toContain('window.addEventListener(SYNC_SERVER_URL_CHANGED_EVENT');
    expect(focusTimerWidgetSource).toContain('window.removeEventListener(SYNC_SERVER_URL_CHANGED_EVENT');
    expect(focusTimerWidgetSource).toContain('buildRemoteDbUrl(syncServerUrl, currentUser)');
  });
});
