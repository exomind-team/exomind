import { describe, expect, it } from 'vitest';
import {
  buildLegacyEventlogImportPayload,
  buildLegacyTaskImportPayload,
} from '@/ui/components/MigrationDialogController';

describe('MigrationDialogController payload helpers', () => {
  it('wraps legacy eventlog imports in the RT backup envelope', () => {
    const payload = buildLegacyEventlogImportPayload([
      { id: 'event-1', content: 'hello' },
    ]);

    expect(payload.version).toBe(1);
    expect(payload.events).toEqual([{ id: 'event-1', content: 'hello' }]);
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
  });

  it('wraps legacy task imports in the RT backup envelope', () => {
    const payload = buildLegacyTaskImportPayload([
      { id: 'task-1', title: 'Focus' },
    ]);

    expect(payload).toEqual({
      version: 1,
      tasks: [{ id: 'task-1', title: 'Focus' }],
    });
  });
});
