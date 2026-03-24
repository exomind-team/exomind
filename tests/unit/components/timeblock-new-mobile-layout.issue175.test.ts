import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('TimeBlockWidget issue-175 new-mobile structure', () => {
  const filePath = path.resolve('src/components/TimeBlockWidget.tsx');
  const source = readFileSync(filePath, 'utf-8');

  it('uses a dedicated action row in running state for mobile layout', () => {
    expect(source).toContain('data-testid="timeblock-action-row"');
    expect(source).toContain('rounded-[24px] border-0 bg-warning');
    expect(source).toContain('rounded-[24px] border-0 bg-[#FDECEB]');
  });
});

