import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('NewNowInputRow issue-175 pencil align', () => {
  const filePath = path.resolve('src/ui/new/components/NewNowInputRow.tsx');
  const source = readFileSync(filePath, 'utf-8');

  it('uses clipboard icon instead of pen-line icon in input trailing action', () => {
    expect(source).toContain('Clipboard');
    expect(source).not.toContain('PenLine');
  });

  it('does not apply safe-area bottom padding on row wrapper', () => {
    expect(source).toContain('mb-2 shrink-0 border-t border-[#E7E5E4] bg-[#FAF7F5]');
    expect(source).not.toContain('safe-area-pb shrink-0');
  });
});
