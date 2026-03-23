import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Vite pouchdb interop config', () => {
  const viteConfigPath = path.resolve('vite.config.ts');
  const content = readFileSync(viteConfigPath, 'utf-8');

  it('does not alias pouchdb to raw browser bundle', () => {
    expect(content).not.toMatch(
      /['"]pouchdb['"]\s*:\s*path\.resolve\(__dirname,\s*['"]\.\/node_modules\/pouchdb\/lib\/index-browser\.js['"]\)/
    );
  });

  it('does not alias pouchdb-utils to raw browser bundle', () => {
    expect(content).not.toMatch(
      /['"]pouchdb-utils['"]\s*:\s*path\.resolve\(__dirname,\s*['"]\.\/node_modules\/pouchdb-utils\/lib\/index-browser\.js['"]\)/
    );
  });

  it('excludes pouchdb from optimizeDeps pre-bundling', () => {
    expect(content).toMatch(
      /optimizeDeps\s*:\s*\{[\s\S]*?exclude\s*:\s*\[[^\]]*['"]pouchdb['"]/m
    );
  });

  it('includes spark-md5 and vuvuzela for CJS interop', () => {
    expect(content).toMatch(
      /optimizeDeps\s*:\s*\{[\s\S]*?include\s*:\s*\[[^\]]*['"]spark-md5['"][\s\S]*?['"]vuvuzela['"]/m
    );
  });

  it('aliases events to a browser-compatible polyfill', () => {
    expect(content).toMatch(
      /alias\s*:\s*\{[\s\S]*?\bevents\b\s*:\s*['"]events\/?['"]/m
    );
  });
});
