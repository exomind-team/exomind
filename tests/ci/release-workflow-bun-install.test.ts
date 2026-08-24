import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readReleaseWorkflow(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
}

function readReleasePagesWorkflow(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/release-pages.yml'), 'utf8');
}

function readTauriConfig(): string {
  return readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8');
}

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('release workflow / 发布流程：单 tag + GitHub Pages', () => {
  it('contains global bun cache cleanup step / 包含 bun 全局缓存清理步骤', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('Clear bun global cache');
  });

  it('uses isolated bun cache directory and retry install fallback / 使用隔离 bun 缓存并带重试安装兜底', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(/--cache-dir|BUN_INSTALL_CACHE_DIR/);
    expect(workflowContent).toMatch(/Retry bun install|retry bun install|attempt 2/i);
  });

  it('reuses bootstrapped bun dependencies for later tauri beforeBuild runs / 后续 tauri beforeBuild 复用前置 bun 安装', () => {
    const workflowContent = readReleaseWorkflow();
    const packageJson = readPackageJson();
    const scripts = (packageJson.scripts ?? {}) as Record<string, string>;

    expect(workflowContent).toContain('EXOMIND_SKIP_BUN_INSTALL=1');
    expect(scripts['ensure:build-deps']).toBeDefined();
    expect(scripts['build:web']).toContain('tsc');
  });

  it('keeps MSI prerequisite probes and local tools dir / 保留 MSI 前置探针与本地工具目录配置', () => {
    const workflowContent = readReleaseWorkflow();
    const tauriConfig = readTauriConfig();

    expect(workflowContent).toContain('Prepare MSI prerequisites');
    expect(workflowContent).toContain('MSI_READY');
    expect(workflowContent).toContain('Runner identity / 运行账号');
    expect(workflowContent).toContain('tauri_bundler=debug');
    expect(tauriConfig).toContain('"useLocalToolsDir": true');
  });

  it('uses single v* tags and removes build/release dual-tag logic / 改为单一 v* tag，移除 build/release 双 tag 逻辑', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('- "v*"');
    expect(workflowContent).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(workflowContent).not.toContain("refs/tags/release/");
    expect(workflowContent).not.toContain("refs/tags/build/");
  });

  it('creates or updates GitHub Release / 创建或更新 GitHub Release', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('softprops/action-gh-release@v2');
  });

  it('deploys GitHub Pages in dedicated workflow / 在独立 workflow 中部署 GitHub Pages', () => {
    const pagesWorkflowContent = readReleasePagesWorkflow();

    expect(pagesWorkflowContent).toContain('workflow_run:');
    expect(pagesWorkflowContent).toContain('Build & Release');
    expect(pagesWorkflowContent).toContain('scripts/dev/sync-release-pages.ts');
    expect(pagesWorkflowContent).toContain('actions/configure-pages@v6');
    expect(pagesWorkflowContent).toContain('actions/upload-artifact@v7');
    expect(pagesWorkflowContent).toContain('actions/deploy-pages@v5');
    expect(pagesWorkflowContent).not.toContain('actions/upload-pages-artifact@v3');
  });

  it('uses github-hosted windows job ids and removes self-hosted residue / 使用 github-hosted windows job 命名并移除 self-hosted 残留', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('build-android-windows:');
    expect(workflowContent).toContain('build-windows:');
    expect(workflowContent).toContain('needs.build-android-windows.result');
    expect(workflowContent).toContain('needs.build-windows.result');
    expect(workflowContent).not.toContain('build-android-selfhosted');
    expect(workflowContent).not.toContain('build-windows-selfhosted');
    expect(workflowContent).not.toContain('D:\\actions-runner\\rust\\cargo');
    expect(workflowContent).not.toContain('D:\\actions-runner\\rust\\rustup');
  });

  it('pins update checks to the GitHub Pages base URL for release builds / 发布构建显式固定更新基址到 GitHub Pages', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('VITE_UPDATE_BASE_URL: https://exomind-team.github.io/exomind/');
    expect(workflowContent).not.toContain('VITE_UPDATE_BASE_URL: "https://exomind-team.github.io/exomind"');
  });

  it('removes Cloudflare R2 upload steps / 不再包含 Cloudflare R2 上传逻辑', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).not.toContain('wrangler r2 object put');
    expect(workflowContent).not.toContain('wrangler r2 object get');
    expect(workflowContent).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(workflowContent).not.toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  it('supports manual promotion of an existing tag / 支持对既有 tag 做手动 promotion', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('workflow_dispatch:');
    expect(workflowContent).toContain('promote_tag');
    expect(workflowContent).toContain('Promote existing GitHub Release');
  });

  it('supports a build-only release validation before tagging / 支持打 tag 前只构建不发布的验证', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('validate_release:');
    expect(workflowContent).toContain('inputs.validate_release == true');
    expect(workflowContent).toContain('Build every release target without publishing');
  });

  it('pins Bun on macOS and Linux and installs from the lockfile / macOS 与 Linux 固定 Bun 并按锁文件安装', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent.match(/uses: oven-sh\/setup-bun@v2/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflowContent.match(/bun-version: \$\{\{ env\.BUN_VERSION \}\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflowContent.match(/bun install --frozen-lockfile --ignore-scripts/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflowContent).not.toContain('npm install -g bun');
  });

  it('publishes only after every platform job succeeds / 仅在全部平台构建成功后发布', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('always() &&');
    expect(workflowContent).toContain("needs.build-android-windows.result == 'success'");
    expect(workflowContent).toContain("needs.build-windows.result == 'success'");
    expect(workflowContent).toContain("needs.build-macos.result == 'success'");
    expect(workflowContent).toContain("needs.build-linux.result == 'success'");
  });

  it('requires a real NSIS setup artifact instead of renaming the raw app binary / 要求真实 NSIS 安装包', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('bun tauri build --bundles nsis');
    expect(workflowContent).toContain('bundle/nsis/');
    expect(workflowContent).toContain('Missing Windows NSIS installer artifact.');
    expect(workflowContent).not.toContain('path: |\n            target/release/exomind.exe');
  });
});
