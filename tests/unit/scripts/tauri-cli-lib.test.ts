import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveTauriExecutable } from '../../../Scripts/dev/tauri-cli-lib';

describe('resolveTauriExecutable', () => {
  it('prefers local node_modules tauri.cmd on Windows（Windows 优先使用本地 tauri.cmd）', () => {
    const projectRoot = 'D:/project/exomind';
    const expected = join(projectRoot, 'node_modules', '.bin', 'tauri.cmd');

    const actual = resolveTauriExecutable({
      projectRoot,
      platform: 'win32',
      exists: (candidate) => candidate === expected,
    });

    expect(actual).toBe(expected);
  });

  it('falls back to PATH executable when local binary is missing（本地不存在时回退 PATH）', () => {
    const projectRoot = 'D:/project/exomind';

    const actual = resolveTauriExecutable({
      projectRoot,
      platform: 'win32',
      exists: () => false,
    });

    expect(actual).toBe('tauri.cmd');
  });
});
