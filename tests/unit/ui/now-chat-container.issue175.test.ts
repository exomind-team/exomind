import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new now chat container issue-175 structure', () => {
  const chatPagePath = path.resolve('src/components/Chat/ChatPage.tsx');
  const source = readFileSync(chatPagePath, 'utf-8');

  it('uses flat full-width container for new-mobile variant instead of rounded card shell', () => {
    expect(source).toContain('flex h-full min-h-0 flex-col bg-surface');
    expect(source).not.toContain('rounded-[24px] border border-[#F0ECE8] bg-[#FAF7F5]');
  });
});
