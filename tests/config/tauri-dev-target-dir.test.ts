import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveTauriDevInstanceName,
  resolveTauriDevTargetDir,
} from '../../Scripts/dev/tauri-dev-target-dir-lib';

describe('tauri dev target dir resolver', () => {
  const projectRoot = path.resolve('D:/project/exomind');

  it('should derive instance name from EXOMIND_WEB_PORT（默认从 Web 端口推导实例名）', () => {
    expect(
      resolveTauriDevInstanceName({
        EXOMIND_WEB_PORT: '1520',
      })
    ).toBe('web-1520');
  });

  it('should sanitize custom instance name（自定义实例名需要安全化）', () => {
    expect(
      resolveTauriDevInstanceName({
        EXOMIND_TAURI_INSTANCE_NAME: 'UI 4K / left panel',
      })
    ).toBe('ui-4k-left-panel');
  });

  it('should resolve project-local target dir by default（默认使用项目内独立 target 目录）', () => {
    expect(
      resolveTauriDevTargetDir(projectRoot, {
        EXOMIND_WEB_PORT: '1620',
      })
    ).toBe(path.join(projectRoot, 'target', 'tauri-dev', 'web-1620'));
  });

  it('should allow explicit override target dir（允许显式覆盖 target 目录）', () => {
    expect(
      resolveTauriDevTargetDir(projectRoot, {
        EXOMIND_TAURI_TARGET_DIR: '.tmp/tauri-dev/custom-a',
      })
    ).toBe(path.resolve(projectRoot, '.tmp/tauri-dev/custom-a'));
  });
});
