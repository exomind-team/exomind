import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fullscreen shortcut routing issue-556', () => {
  it('wires useTauriFullscreenShortcut into NewLayout', () => {
    const sourcePath = path.resolve('src/routes.tsx');
    const source = readFileSync(sourcePath, 'utf-8');

    expect(source).toContain("import { useTauriFullscreenShortcut } from '@/ui/app/hooks/useTauriFullscreenShortcut';");

    const newLayoutStart = source.indexOf('function NewLayout() {');
    expect(newLayoutStart).toBeGreaterThanOrEqual(0);

    const newLayoutSlice = source.slice(newLayoutStart, newLayoutStart + 500);
    expect(newLayoutSlice).toContain('useTauriFullscreenShortcut();');
  });
});
