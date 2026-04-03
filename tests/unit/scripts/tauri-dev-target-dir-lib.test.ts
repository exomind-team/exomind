import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveTauriDevTargetDir } from '../../../scripts/dev/tauri-dev-target-dir-lib';

describe('tauri-dev-target-dir-lib', () => {
  it('uses local cargo build.target-dir as the root for instance-isolated tauri builds（本地 cargo target-dir 应作为 tauri dev 实例根目录）', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'tauri-dev-target-root-'));

    try {
      const cargoDir = path.join(projectRoot, '.cargo');
      mkdirSync(cargoDir, { recursive: true });
      writeFileSync(
        path.join(cargoDir, 'config.toml'),
        [
          '[build]',
          "target-dir = 'G:/exomind-cargo-target'",
          '',
        ].join('\n'),
        'utf8',
      );

      const resolved = resolveTauriDevTargetDir(projectRoot, {
        EXOMIND_TAURI_INSTANCE_NAME: 'issue806-g',
      });

      expect(resolved).toBe(path.join('G:/exomind-cargo-target', 'tauri-dev', 'issue806-g'));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps explicit EXOMIND_TAURI_TARGET_DIR higher priority than cargo config（显式目标目录应优先于 cargo 配置）', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'tauri-dev-target-explicit-'));

    try {
      const cargoDir = path.join(projectRoot, '.cargo');
      mkdirSync(cargoDir, { recursive: true });
      writeFileSync(
        path.join(cargoDir, 'config.toml'),
        [
          '[build]',
          "target-dir = 'G:/exomind-cargo-target'",
          '',
        ].join('\n'),
        'utf8',
      );

      const resolved = resolveTauriDevTargetDir(projectRoot, {
        EXOMIND_TAURI_INSTANCE_NAME: 'issue806-g',
        EXOMIND_TAURI_TARGET_DIR: 'custom-target-root/manual-instance',
      });

      expect(resolved).toBe(path.resolve(projectRoot, 'custom-target-root/manual-instance'));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
