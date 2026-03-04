import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('useSignalStream m4（SSE 默认端口）', () => {
  it('uses embedded runtime port 4077 by default（默认连接 4077）', () => {
    const source = readFileSync('src/ui/hooks/useSignalStream.ts', 'utf-8');
    expect(source).toContain("const RT_PORT = 4077;");
  });
});
