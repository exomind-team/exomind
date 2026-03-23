import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pouchdb sync server dependencies', () => {
  it('declares pouchdb-adapter-leveldb for runtime startup compatibility（运行时启动兼容）', () => {
    const packageJsonPath = path.resolve('server/package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };

    // Keep leveldb adapter in direct deps so `bun install --omit optional` still works（避免省略可选依赖后启动失败）.
    expect(packageJson.dependencies?.['pouchdb-adapter-leveldb']).toBeTruthy();
  });
});
