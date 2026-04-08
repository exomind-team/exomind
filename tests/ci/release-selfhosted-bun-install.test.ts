import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readReleaseWorkflow(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
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

    expect(workflowContent).toContain("- 'v*'");
    expect(workflowContent).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(workflowContent).not.toContain("refs/tags/release/");
    expect(workflowContent).not.toContain("refs/tags/build/");
  });

  it('creates or updates GitHub Release and deploys GitHub Pages / 创建或更新 GitHub Release，并部署 GitHub Pages', () => {
    const workflowContent = readReleaseWorkflow();

    expect(workflowContent).toContain('softprops/action-gh-release@v2');
    expect(workflowContent).toContain('actions/configure-pages@v5');
    expect(workflowContent).toContain('actions/upload-pages-artifact@v3');
    expect(workflowContent).toContain('actions/deploy-pages@v4');
    expect(workflowContent).toContain('scripts/dev/sync-release-pages.ts');
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
});
