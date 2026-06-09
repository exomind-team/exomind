import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app shell selection（应用壳层选择）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');
  const selectionStart = source.indexOf('const selectedShell =');
  const desktopBranchStart = source.indexOf("if (selectedShell === 'desktop')");
  const selectionBlock = source.slice(selectionStart, desktopBranchStart);

  it('inlines shell selection in routes（在路由处内联壳层选择）', () => {
    expect(source).not.toContain("@/ui/app/layout/shell-mode");
    expect(source).not.toContain('resolveAppShellMode');
    expect(selectionBlock).toContain(
      "const selectedShell = isDesktop && desktopAdaptiveEnabled ? 'desktop' : 'mobile';",
    );
  });

  it('does not keep a route whitelist for desktop shell（不保留桌面壳白名单）', () => {
    expect(selectionBlock).not.toContain('pathname');
    expect(selectionBlock).not.toContain('startsWith');
    expect(selectionBlock).not.toContain('/eventlog');
    expect(selectionBlock).not.toContain('/tasks');
    expect(selectionBlock).not.toContain('/proposals');
    expect(selectionBlock).not.toContain('/sync-test');
    expect(selectionBlock).not.toContain('/volcano-asr-test');
  });

  it('keeps shell choice only on viewport + adaptive toggle（壳层只由视口与桌面适配开关决定）', () => {
    expect(selectionBlock).toContain('isDesktop');
    expect(selectionBlock).toContain('desktopAdaptiveEnabled');
    expect(selectionBlock).not.toContain('location.pathname');
  });
});
