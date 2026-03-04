import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readReleaseWorkflow(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
}

describe('release workflow / 发布流程: self-hosted bun install hardening', () => {
  it('contains global bun cache cleanup step / 包含 bun 全局缓存清理步骤', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('Clear bun global cache');
  });

  it('uses isolated bun cache directory / 使用隔离 bun 缓存目录', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(/--cache-dir|BUN_INSTALL_CACHE_DIR/);
  });

  it('contains retry install fallback / 包含重试安装兜底逻辑', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(/Retry bun install|retry bun install|bun install attempt 2/i);
  });

  it('does not build NSIS bundle / 不再构建 NSIS 安装包', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).not.toContain('bun tauri build --bundles nsis');
  });
});
