import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('settings theme variables', () => {
  it('defines the default settings tone from the shared brand accent variable', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

    expect(css).toContain('--settings-tone-default: hsl(var(--brand-accent));');
    expect(css).toContain('border-color: var(--settings-tone-color, var(--settings-tone-default));');
    expect(css).toContain('background-color: var(--settings-tone-color, var(--settings-tone-default));');
  });
});
