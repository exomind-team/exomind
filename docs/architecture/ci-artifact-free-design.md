# CI 无 Artifact 存储方案设计

## 背景

当前 CI 使用 GitHub Actions Artifact 在 Job 之间传递构建产物，占用存储配额。本方案设计如何完全不使用 Artifact 存储。

---

## 环境分布

| 平台 | Runner 类型 | 构建能力 |
|------|------------|---------|
| Windows | Self-hosted | ✅ Windows Desktop |
| Android | Self-hosted | ✅ Android APK |
| Linux | Self-hosted (WSL) | ✅ Linux AppImage/DEB |
| macOS | GitHub-hosted | ✅ macOS DMG |

---

## 方案设计：分层存储策略

### 核心思路

1. **Self-hosted 构建** → 本地共享目录 `D:\ci-artifacts\{run_id}\`
2. **GitHub-hosted 构建** → 直接上传 R2
3. **汇总 Job** → 从本地目录 + R2 收集 → GitHub Release + R2

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    构建产物流转架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Self-hosted Windows Runner                                 │
│  ├── Windows 构建 ──→ D:\ci-artifacts\{run_id}\windows\    │
│  ├── Android 构建 ──→ D:\ci-artifacts\{run_id}\android\    │
│  └── Linux 构建 ──→ D:\ci-artifacts\{run_id}\linux\        │
│                                                             │
│  GitHub-hosted macOS Runner                                 │
│  └── macOS 构建 ──→ R2: exomind-ci/{run_id}/macos/         │
│                                                             │
│  汇总 Job (Self-hosted Windows)                             │
│  ├── 从本地目录收集 Windows/Android/Linux                   │
│  ├── 从 R2 下载 macOS                                       │
│  ├── 创建 GitHub Release                                    │
│  ├── 上传全部到 R2 (正式路径)                               │
│  └── 清理本地目录 + R2 临时目录                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现细节

### 1. Self-hosted 构建 Job

**Windows 构建示例**：

```yaml
build-windows:
  runs-on: [self-hosted, Windows, X64]
  steps:
    - uses: actions/checkout@v4

    - name: Build
      run: bun run tauri build

    - name: Save to shared directory (保存到共享目录)
      shell: powershell
      run: |
        $sharedDir = "D:\ci-artifacts\${{ github.run_id }}\windows"
        New-Item -ItemType Directory -Force -Path $sharedDir | Out-Null

        # 复制 EXE
        Copy-Item -Path src-tauri/target/release/bundle/nsis/*.exe `
          -Destination $sharedDir/ -Force

        # 复制 MSI (如果存在)
        if (Test-Path src-tauri/target/release/bundle/msi/*.msi) {
          Copy-Item -Path src-tauri/target/release/bundle/msi/*.msi `
            -Destination $sharedDir/ -Force
        }

        # 复制 runtime
        $runtimeDir = "$sharedDir\runtime"
        New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
        Copy-Item -Path target/release/exomind-rt.exe `
          -Destination $runtimeDir/exomind-rt-windows-x64.exe -Force

        Write-Host "✅ Saved to: $sharedDir"
        Get-ChildItem -Recurse $sharedDir
```

**Android 构建示例**：

```yaml
build-android:
  runs-on: [self-hosted, Windows, X64]
  steps:
    - uses: actions/checkout@v4

    - name: Build
      run: bun run tauri android build

    - name: Save to shared directory (保存到共享目录)
      shell: powershell
      run: |
        $sharedDir = "D:\ci-artifacts\${{ github.run_id }}\android"
        New-Item -ItemType Directory -Force -Path $sharedDir | Out-Null

        # 复制所有 APK
        Copy-Item -Path gen/android/app/build/outputs/apk/**/*.apk `
          -Destination $sharedDir/ -Force -Recurse

        Write-Host "✅ Saved to: $sharedDir"
        Get-ChildItem -Recurse $sharedDir
```

**Linux 构建示例**：

```yaml
build-linux:
  runs-on: [self-hosted, Windows, X64]
  steps:
    - uses: actions/checkout@v4

    - name: Build in WSL
      shell: bash
      run: |
        # 在 WSL 中构建
        wsl bash -c "cd /mnt/d/project/exomind && bun run tauri build"

    - name: Save to shared directory (保存到共享目录)
      shell: powershell
      run: |
        $sharedDir = "D:\ci-artifacts\${{ github.run_id }}\linux"
        New-Item -ItemType Directory -Force -Path $sharedDir | Out-Null

        # 从 WSL 复制产物
        Copy-Item -Path src-tauri/target/release/bundle/appimage/*.AppImage `
          -Destination $sharedDir/ -Force
        Copy-Item -Path src-tauri/target/release/bundle/deb/*.deb `
          -Destination $sharedDir/ -Force

        Write-Host "✅ Saved to: $sharedDir"
        Get-ChildItem -Recurse $sharedDir
```

---

### 2. GitHub-hosted 构建 Job (macOS)

```yaml
build-macos:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4

    - name: Setup Bun
      uses: oven-sh/setup-bun@v2

    - name: Build
      run: bun run tauri build

    - name: Install rclone
      run: brew install rclone

    - name: Upload to R2 (直接上传 R2)
      env:
        R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
        R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
      run: |
        # 配置 rclone
        rclone config create r2 s3 \
          provider=Cloudflare \
          access_key_id="$R2_ACCESS_KEY_ID" \
          secret_access_key="$R2_SECRET_ACCESS_KEY" \
          endpoint="$R2_ENDPOINT"

        # 上传到临时目录
        rclone copy src-tauri/target/release/bundle/dmg/ \
          r2:exomind-ci/${{ github.run_id }}/macos/ \
          --progress

        rclone copy src-tauri/target/release/bundle/macos/ \
          r2:exomind-ci/${{ github.run_id }}/macos/ \
          --include "*.app.tar.gz" \
          --progress

        echo "✅ Uploaded to R2: exomind-ci/${{ github.run_id }}/macos/"
```

---

### 3. 汇总 Job (create-release)

```yaml
create-release:
  needs: [build-windows, build-android, build-linux, build-macos]
  if: |
    always() &&
    startsWith(github.ref, 'refs/tags/release/') &&
    (
      needs.build-windows.result == 'success' ||
      needs.build-android.result == 'success' ||
      needs.build-linux.result == 'success' ||
      needs.build-macos.result == 'success'
    )
  runs-on: [self-hosted, Windows, X64]
  steps:
    - uses: actions/checkout@v4

    # ─────────────────────────────────────────────
    # Step 1: 从本地目录收集 Self-hosted 构建产物
    # ─────────────────────────────────────────────
    - name: Collect from shared directory (从共享目录收集)
      shell: powershell
      run: |
        $sharedDir = "D:\ci-artifacts\${{ github.run_id }}"
        $releaseDir = "release-files"

        if (Test-Path $sharedDir) {
          Write-Host "📦 Collecting from: $sharedDir"
          Copy-Item -Recurse -Path "$sharedDir\*" -Destination $releaseDir -Force
          Get-ChildItem -Recurse $releaseDir
        } else {
          Write-Host "⚠️ Shared directory not found: $sharedDir"
        }

    # ─────────────────────────────────────────────
    # Step 2: 从 R2 下载 macOS 构建产物
    # ─────────────────────────────────────────────
    - name: Install rclone
      shell: powershell
      run: |
        if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
          Write-Host "Installing rclone..."
          choco install rclone -y
        }

    - name: Download macOS from R2 (从 R2 下载 macOS)
      if: needs.build-macos.result == 'success'
      env:
        R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
        R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
      shell: bash
      run: |
        # 配置 rclone
        rclone config create r2 s3 \
          provider=Cloudflare \
          access_key_id="$R2_ACCESS_KEY_ID" \
          secret_access_key="$R2_SECRET_ACCESS_KEY" \
          endpoint="$R2_ENDPOINT"

        # 下载 macOS 产物
        mkdir -p release-files/macos
        rclone copy r2:exomind-ci/${{ github.run_id }}/macos/ \
          release-files/macos/ \
          --progress

        echo "✅ Downloaded macOS artifacts"
        ls -laR release-files/macos/

    # ─────────────────────────────────────────────
    # Step 3: 统一命名
    # ─────────────────────────────────────────────
    - name: Normalize release artifact names (统一发布产物命名)
      shell: bash
      run: |
        set -euo pipefail
        shopt -s nullglob globstar

        version="${GITHUB_REF_NAME#release/}"
        short_hash="${GITHUB_SHA::7}"
        source_dir="release-files"
        output_dir="release-assets"
        mkdir -p "$output_dir"

        # Windows EXE
        exe_files=("$source_dir"/**/*.exe)
        if (( ${#exe_files[@]} > 0 )); then
          cp "${exe_files[0]}" "$output_dir/ExoMind-${version}-${short_hash}-windows-x64-setup.exe"
        fi

        # Windows MSI
        msi_files=("$source_dir"/**/*.msi)
        if (( ${#msi_files[@]} > 0 )); then
          cp "${msi_files[0]}" "$output_dir/ExoMind-${version}-${short_hash}-windows-x64-installer.msi"
        fi

        # Android APK
        apk_files=("$source_dir"/**/*.apk)
        for apk in "${apk_files[@]}"; do
          file_name="$(basename "$apk" | tr '[:upper:]' '[:lower:]')"
          if [[ "$file_name" == *"arm64"* ]]; then
            cp "$apk" "$output_dir/ExoMind-${version}-${short_hash}-android-arm64.apk"
          elif [[ "$file_name" == *"x86"* ]]; then
            cp "$apk" "$output_dir/ExoMind-${version}-${short_hash}-android-x86.apk"
          fi
        done

        # macOS DMG
        dmg_files=("$source_dir"/**/*.dmg)
        if (( ${#dmg_files[@]} > 0 )); then
          cp "${dmg_files[0]}" "$output_dir/ExoMind-${version}-${short_hash}-macos-universal.dmg"
        fi

        # Linux AppImage
        appimage_files=("$source_dir"/**/*.AppImage)
        if (( ${#appimage_files[@]} > 0 )); then
          cp "${appimage_files[0]}" "$output_dir/ExoMind-${version}-${short_hash}-linux-x86_64.AppImage"
        fi

        echo "✅ Normalized artifacts:"
        ls -lh "$output_dir"

    # ─────────────────────────────────────────────
    # Step 4: 创建 GitHub Release
    # ─────────────────────────────────────────────
    - name: Create GitHub Release
      env:
        GH_TOKEN: ${{ github.token }}
      shell: bash
      run: |
        version="${GITHUB_REF_NAME#release/}"

        gh release create "$version" \
          --title "Release $version" \
          --notes "Auto-generated release for $version" \
          release-assets/*

    # ─────────────────────────────────────────────
    # Step 5: 上传到 R2 正式路径
    # ─────────────────────────────────────────────
    - name: Upload to R2 (上传到 R2 正式路径)
      env:
        R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
        R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
      shell: bash
      run: |
        version="${GITHUB_REF_NAME#release/}"

        # 上传到正式路径
        rclone copy release-assets/ \
          r2:exomind-releases/$version/ \
          --progress

        echo "✅ Uploaded to R2: exomind-releases/$version/"

    # ─────────────────────────────────────────────
    # Step 6: 清理临时文件
    # ─────────────────────────────────────────────
    - name: Cleanup (清理临时文件)
      if: always()
      shell: powershell
      run: |
        # 清理本地共享目录
        $sharedDir = "D:\ci-artifacts\${{ github.run_id }}"
        if (Test-Path $sharedDir) {
          Remove-Item -Recurse -Force $sharedDir
          Write-Host "✅ Cleaned up: $sharedDir"
        }

    - name: Cleanup R2 temp directory (清理 R2 临时目录)
      if: always()
      env:
        R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
        R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
      shell: bash
      run: |
        # 清理 R2 临时目录
        rclone delete r2:exomind-ci/${{ github.run_id }}/ --rmdirs
        echo "✅ Cleaned up R2: exomind-ci/${{ github.run_id }}/"
```

---

## R2 目录结构

```
exomind-ci/                    # 临时构建目录
├── {run_id}/
│   └── macos/
│       ├── *.dmg
│       └── *.app.tar.gz

exomind-releases/              # 正式发布目录
├── v0.3.3/
│   ├── ExoMind-v0.3.3-abc1234-windows-x64-setup.exe
│   ├── ExoMind-v0.3.3-abc1234-android-arm64.apk
│   ├── ExoMind-v0.3.3-abc1234-macos-universal.dmg
│   └── ExoMind-v0.3.3-abc1234-linux-x86_64.AppImage
└── v0.3.4-build.20260301T1430/
    └── ...
```

---

## 优势

| 优势 | 说明 |
|------|------|
| ✅ **零 Artifact 存储** | 完全不使用 GitHub Actions Artifact |
| ✅ **快速传输** | Self-hosted 使用本地文件系统，速度快 |
| ✅ **统一存储** | 最终产物统一存储在 R2 |
| ✅ **自动清理** | 构建完成后自动清理临时文件 |
| ✅ **容错性强** | 单个平台失败不影响其他平台 |

---

## 注意事项

### 1. R2 Secrets 配置

需要在 GitHub Secrets 中配置：

```
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
```

### 2. 本地目录权限

确保 Self-hosted Runner 有权限访问 `D:\ci-artifacts\`：

```powershell
# 创建目录
New-Item -ItemType Directory -Force -Path D:\ci-artifacts

# 设置权限（如果需要）
icacls D:\ci-artifacts /grant "BUILTIN\Users:(OI)(CI)F" /T
```

### 3. rclone 安装

**Windows (Self-hosted)**:
```powershell
choco install rclone -y
```

**macOS (GitHub-hosted)**:
```bash
brew install rclone
```

### 4. 清理策略

- **本地目录**: 每次构建完成后立即清理
- **R2 临时目录**: 每次构建完成后立即清理
- **R2 正式目录**: 手动清理旧版本（可选）

---

## 迁移步骤

1. **配置 R2 Secrets**
2. **修改 `.github/workflows/release.yml`**
3. **测试单个平台构建**
4. **测试完整发布流程**
5. **删除所有 `actions/upload-artifact` 和 `actions/download-artifact`**

---

## 成本对比

| 项目 | 当前方案 | 新方案 |
|------|---------|--------|
| GitHub Actions 存储 | 占用配额 | **0** |
| R2 存储 | 0 | 少量（临时目录自动清理） |
| 传输速度 | 慢（上传+下载） | 快（本地文件系统） |
| 维护成本 | 低 | 中（需要管理 R2） |

---

*文档版本: v1.0*
*更新时间: 2026-03-01*
