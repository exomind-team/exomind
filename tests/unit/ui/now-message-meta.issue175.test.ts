import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new now message meta issue-175 structure', () => {
  const chatPagePath = path.resolve('src/components/Chat/ChatPage.tsx');
  const source = readFileSync(chatPagePath, 'utf-8');

  it('contains mobile message rows with avatar and meta info slots', () => {
    expect(source).toContain('data-testid="new-mobile-system-message-row"');
    expect(source).toContain('data-testid="new-mobile-user-message-row"');
    expect(source).toContain('data-testid="new-mobile-message-meta"');
  });

  it('contains device and time text format for message meta', () => {
    expect(source).toContain('AI 助理');
    expect(source).toContain('formatEventSourceLabel(event)');
    expect(source).toContain('未知设备');
    expect(source).toContain('formatMessageTime(event.timestamp)');
  });
});

