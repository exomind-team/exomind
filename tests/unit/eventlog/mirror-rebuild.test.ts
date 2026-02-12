import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EventData } from '@/lib/types/event';
import {
  rebuildMirrorMarkdown,
  type MirrorCheckpoint,
} from '@/lib/eventlog/mirror';

describe('eventlog mirror rebuild', () => {
  it('rebuilds markdown in stable time order and returns checkpoint', () => {
    const events: EventData[] = [
      { id: 'evt-2', timestamp: 2000, content: 'second', tags: ['note'] },
      { id: 'evt-1', timestamp: 1000, content: 'first', tags: ['note', 'user'] },
    ];

    const result = rebuildMirrorMarkdown(events, 3000);
    const checkpoint: MirrorCheckpoint = result.checkpoint;

    expect(result.markdown).toContain('event_id: evt-1');
    expect(result.markdown).toContain('event_id: evt-2');
    expect(result.markdown.indexOf('event_id: evt-1')).toBeLessThan(
      result.markdown.indexOf('event_id: evt-2')
    );
    expect(checkpoint.lastEventId).toBe('evt-2');
    expect(checkpoint.updatedAtMs).toBe(3000);
  });

  it('registers mirror commands in tauri backend', () => {
    const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf-8');

    expect(tauriLib).toContain('eventlog_mirror_status');
    expect(tauriLib).toContain('eventlog_rebuild_markdown');
  });
});
