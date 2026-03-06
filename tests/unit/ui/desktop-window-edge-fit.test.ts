import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop window edge fit（桌面端贴边窗口）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');
  const layoutStart = source.indexOf('function DesktopLayout');
  const layoutEnd = source.indexOf('function NewLayout', layoutStart);
  const layoutBlock = source.slice(layoutStart, layoutEnd);

  it('removes outer desktop frame padding and centered shell（移除桌面外层留白与居中壳层）', () => {
    expect(layoutBlock).not.toContain('p-6');
    expect(layoutBlock).not.toContain('max-w-[1400px]');
    expect(layoutBlock).not.toContain('mx-auto');
    expect(layoutBlock).not.toContain('rounded-2xl');
    expect(layoutBlock).not.toContain('shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]');
  });

  it('stretches desktop shell to full window size（桌面壳层拉伸到整个窗口）', () => {
    expect(layoutBlock).toContain('h-[100dvh]');
    expect(layoutBlock).toContain('w-full');
  });
});
