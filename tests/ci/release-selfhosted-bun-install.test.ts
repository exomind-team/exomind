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

  it('skips MSI on NetworkService runner account / 在 NetworkService 账号下跳过 MSI', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('nt authority\\network service');
  });

  it('uploads self-hosted artifacts directly to Cloudflare R2 on workflow_dispatch / 手动触发时由 self-hosted 直接上传到 R2', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('Upload self-hosted artifacts to Cloudflare R2');
    expect(workflowContent).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflowContent).toContain('wrangler r2 object put');
    expect(workflowContent).toContain('"target/release/exomind.exe"');
    expect(workflowContent).toContain('"src-tauri/target/release/exomind.exe"');
  });

  it('skips GitHub artifact upload on workflow_dispatch in self-hosted job / 手动触发时跳过 GitHub artifact 中转', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(
      /name:\s*Upload Android signed APK Artifact[\s\S]*?if:\s*steps\.targets\.outputs\.BUILD_ANDROID == 'true' && github\.event_name != 'workflow_dispatch'/,
    );
    expect(workflowContent).toMatch(
      /name:\s*Upload Windows EXE Artifact[\s\S]*?if:\s*steps\.targets\.outputs\.BUILD_WINDOWS == 'true' && github\.event_name != 'workflow_dispatch'/,
    );
  });
});
