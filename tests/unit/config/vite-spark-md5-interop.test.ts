import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Vite spark-md5 interop config', () => {
  const viteConfigPath = path.resolve('vite.config.ts');
  const content = readFileSync(viteConfigPath, 'utf-8');

  it('does not alias spark-md5 to raw UMD file', () => {
    expect(content).not.toMatch(
      /['"]spark-md5['"]\s*:\s*path\.resolve\(__dirname,\s*['"]\.\/node_modules\/spark-md5\/spark-md5\.js['"]\)/
    );
  });

  it('does not exclude spark-md5 from optimizeDeps', () => {
    expect(content).not.toMatch(
      /optimizeDeps\s*:\s*\{[\s\S]*?exclude\s*:\s*\[[^\]]*['"]spark-md5['"]/m
    );
  });
});
