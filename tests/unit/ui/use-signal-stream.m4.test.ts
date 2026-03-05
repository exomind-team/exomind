import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('useSignalStream m4（SSE Runtime 目标切换）', () => {
  it('listens runtime target changes（监听 Runtime 目标变更）', () => {
    const source = readFileSync('src/ui/hooks/useSignalStream.ts', 'utf-8');
    expect(source).toContain('subscribeRuntimeTargetChanges');
    expect(source).toContain('getSelectedRuntimeTarget');
  });
});
