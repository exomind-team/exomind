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
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as Record<string, unknown>;
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

  it('reuses bootstrapped bun dependencies for later tauri beforeBuild runs / 后续 tauri beforeBuild 复用前置 bun 依赖安装', () => {
    const workflowContent = readReleaseWorkflow();
    const packageJson = readPackageJson();
    const scripts = (packageJson.scripts ?? {}) as Record<string, string>;

    expect(workflowContent).toContain('EXOMIND_SKIP_BUN_INSTALL=1');
    expect(scripts['build']).toContain('ensure:build-deps');
    expect(scripts['build:web']).toBe('tsc && vite build');
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

  it('does not hard-block MSI purely by NetworkService identity / 不再仅因 NetworkService 账号名硬性跳过 MSI', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).not.toContain('NetworkService account is detected. MSI build is disabled');
    expect(workflowContent).not.toContain('$runnerIdentity -eq "nt authority\\network service"');
    expect(workflowContent).toContain('Runner identity / 运行账号');
  });

  it('uploads self-hosted artifacts directly to Cloudflare R2 on workflow_dispatch / 手动触发时由 self-hosted 直接上传到 R2', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('Upload self-hosted artifacts to Cloudflare R2');
    expect(workflowContent).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflowContent).toContain('wrangler r2 object put');
    expect(workflowContent).toContain('"target/release/exomind.exe"');
    expect(workflowContent).toContain('"src-tauri/target/release/exomind.exe"');
  });

  it('generates website-compatible latest metadata on workflow_dispatch / 手动触发时也生成官网可识别的 latest 元数据', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(/\$artifactVersion = if \(\$isBuildTagPush -or \$isReleaseTagPush\) \{ \$versionDir \} else \{ "v\$version" \}/);
    expect(workflowContent).toContain('Generate latest metadata for website consumers');
    expect(workflowContent).toContain('$shouldPublishLatestMetadata = $isBuildTagPush -or $isReleaseTagPush -or "${{ github.event_name }}" -eq "workflow_dispatch"');
  });

  it('uses OrderedDictionary-compatible asset alias checks / 资源别名检查兼容 OrderedDictionary', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).not.toContain('ContainsKey(');
    expect(workflowContent).toContain('$assets.Contains($aliasKey)');
  });

  it('recovers MSI via WiX light -sval fallback on service runners / 服务型 runner 上通过 WiX light -sval 回退恢复 MSI', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('Recover Windows MSI artifact via WiX light fallback');
    expect(workflowContent).toContain('-sval');
  });

  it('skips GitHub artifact upload on workflow_dispatch in self-hosted job / 手动触发时跳过 GitHub artifact 中转', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(
      /name:\s*Upload Android signed APK Artifact[\s\S]*?if:\s*steps\.targets\.outputs\.BUILD_ANDROID == 'true' && github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/release\/'\)/,
    );
    expect(workflowContent).toMatch(
      /name:\s*Upload Windows EXE Artifact[\s\S]*?if:\s*steps\.targets\.outputs\.BUILD_WINDOWS == 'true' && github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/release\/'\)/,
    );
  });

  it('uploads macOS DMG from both workspace-root and src-tauri bundle paths / macOS DMG 上传同时兼容 workspace 根目录与 src-tauri 路径', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(
      /name:\s*Upload macOS DMG Artifact[\s\S]*?path:\s*\|[\s\S]*?target\/release\/bundle\/dmg\/[\s\S]*?src-tauri\/target\/release\/bundle\/dmg\//,
    );
  });

  it('uploads Linux DEB and AppImage from both workspace-root and src-tauri bundle paths / Linux 产物上传同时兼容 workspace 根目录与 src-tauri 路径', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toMatch(
      /name:\s*Upload Linux DEB Artifact[\s\S]*?path:\s*\|[\s\S]*?target\/release\/bundle\/deb\/[\s\S]*?src-tauri\/target\/release\/bundle\/deb\//,
    );
    expect(workflowContent).toMatch(
      /name:\s*Upload Linux AppImage Artifact[\s\S]*?path:\s*\|[\s\S]*?target\/release\/bundle\/appimage\/[\s\S]*?src-tauri\/target\/release\/bundle\/appimage\//,
    );
  });

  it('aliases runtime tarballs into desktop latest.json keys / latest.json 生成时将 runtime tar 包映射为桌面平台键', () => {
    const workflowContent = readReleaseWorkflow();
    expect(workflowContent).toContain('alias_asset "macos-aarch64" "runtime-macos-aarch64"');
    expect(workflowContent).toContain('alias_asset "linux-x64-appimage" "runtime-linux-x64"');
  });
});
