import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AppLayout bottom nav spacing issue-175', () => {
  const filePath = path.resolve('src/routes.tsx');
  const source = readFileSync(filePath, 'utf-8');

  it('uses bottom offset for main container instead of padding-bottom reservation', () => {
    expect(source).toContain('bottom-[calc(env(safe-area-inset-bottom,0px)+60px)]');
    expect(source).not.toContain('pb-[calc(env(safe-area-inset-bottom,0px)+98px)]');
  });
});

