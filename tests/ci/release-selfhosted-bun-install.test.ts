import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readReleaseWorkflow(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
}

function readTauriConfig(): string {
  return readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8');
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

  it('uses local tools dir for Windows system users / Windows 服务账号使用本地工具目录', () => {
    const tauriConfig = readTauriConfig();
    expect(tauriConfig).toContain('"useLocalToolsDir": true');
  });

  it('checks MSI prerequisites before running light.exe / MSI 前执行前置检查', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('Prepare MSI prerequisites');
  });

  it('enables tauri bundler debug logs for MSI failures / MSI 失败时开启 tauri bundler 调试日志', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('tauri_bundler=debug');
  });

  it('gates MSI build by prerequisite probe result / 仅在前置探针通过时执行 MSI 构建', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('MSI_READY');
    expect(workflowContent).toContain("steps.msi_prereq.outputs.MSI_READY == 'true'");
  });
});
