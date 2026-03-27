import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getStepsForPreset,
  resolveStepStdio,
} = require('../../Scripts/test/runtime-dispatch.cjs') as {
  getStepsForPreset: (runtime: string, name: string, args: string[]) => Array<Record<string, unknown>>;
  resolveStepStdio: (step: Record<string, unknown>) => unknown;
};

describe('runtime-dispatch vite-dev stdio', () => {
  it('ignores stdin for vite-dev so Playwright webServer cannot terminate it by closing stdin', () => {
    const [step] = getStepsForPreset('node', 'vite-dev', []);
    expect(step).toMatchObject({
      command: 'node',
      ignoreStdin: true,
    });
    expect(resolveStepStdio(step)).toEqual(['ignore', 'inherit', 'inherit']);
  });

  it('keeps default inherited stdio for non-server presets', () => {
    const [step] = getStepsForPreset('node', 'playwright', ['test']);
    expect(step).toMatchObject({
      command: 'node',
    });
    expect(resolveStepStdio(step)).toBe('inherit');
  });
});
