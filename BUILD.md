# ExoMind 构建指南

> ExoMind 项目构建和 CI/CD 流程说明
> 版本: v1.1
> 更新日期: 2026-02-18

---

## 目录

1. [环境要求](#环境要求)
2. [本地构建](#本地构建)
3. [CI/CD 自动化构建](#cicd-自动化构建)
4. [常见问题](#常见问题)

---

## 环境要求

### 通用依赖

| 工具 | 要求 | 说明 |
|------|------|------|
| [Bun](https://bun.sh/) | 最新版本 | JavaScript 包管理器 |
| [Rust](https://rustup.rs/) | 稳定版 | 后端编译（Edition 2021） |
| [Git](https://git-scm.com/) | - | 版本控制 |

### 平台特定依赖

#### Windows

- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
  - 选择 "C++ 构建工具" 工作负载
  - 确保安装 Windows SDK

#### macOS

- Xcode Command Line Tools: `xcode-select --install`
- Xcode: 最新稳定版

#### Android

- [Android Studio](https://developer.android.com/studio) - 最新版本
- JDK 17 - Android 构建必需
- Android SDK - API Level 34+
- NDK - 通过 SDK Manager 安装

---

## 本地构建

### 依赖安装

```bash
# 安装项目依赖
bun install
```

### 桌面端构建

#### 开发模式

```bash
# 启动开发服务器（热重载）
bun run tauri dev
```

#### 发布构建

```bash
# 构建发布版本
bun run tauri build --bundles msi    # Windows
bun run tauri build --bundles dmg    # macOS
bun run tauri build --bundles deb    # Linux
```

#### 构建产物

| 平台 | 产物 | 路径 |
|------|------|------|
| Windows | MSI 安装包 | `src-tauri/target/release/bundle/msi/*.msi` |
| Windows | NSIS 安装包 | `src-tauri/target/release/bundle/nsis/*.exe` |
| macOS | DMG 安装包 | `src-tauri/target/release/bundle/dmg/*.dmg` |
| macOS | App 目录 | `src-tauri/target/release/bundle/osx/*.app` |
| Linux | DEB 包 | `src-tauri/target/release/bundle/deb/*.deb` |
| 所有平台 | 可执行文件 | `src-tauri/target/release/exomind` |

### Android 构建

#### 首次初始化

```bash
# 初始化 Android 项目（首次需要）
bun run tauri android init
```

#### 开发模式

```bash
# 启动 Android 开发（需要连接设备或模拟器）
bun run tauri android dev
```

#### 发布构建

```bash
# Debug 构建（用于测试）
bun run tauri android build --debug
# 输出: src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk

# Release 构建（用于发布）
bun run tauri android build
# 输出: src-tauri/gen/android/app/build/outputs/apk/release/app-release-unsigned.apk
```

#### Android SDK 配置

如果使用本地 SDK，设置环境变量：

```bash
# Linux/macOS
export ANDROID_HOME=/path/to/android-sdk
export ANDROID_SDK_ROOT=/path/to/android-sdk

# Windows PowerShell
$env:ANDROID_HOME = "D:\Android\Sdk"
$env:ANDROID_SDK_ROOT = "D:\Android\Sdk"
```

---

## CI/CD 自动化构建

### GitHub Actions

项目使用 GitHub Actions 实现自动化构建和发布。

#### 工作流程文件

位置: `.github/workflows/release.yml`

#### 触发条件

| Tag 模式 | 触发 | 产出 |
|----------|------|------|
| `build/**` | 推送到 build tag | 构建产物 (Artifact) |
| `release/**` | 推送 release tag | 构建产物 + GitHub Release（支持 preview 预发布） |

#### Tag 命名规范

```
# 构建 Tag（仅构建）
build/v{主}.{次}.{修订}-{commit_hash}

# 发布 Tag（构建 + Release）
release/v{主}.{次}.{修订}

# 预览发布 Tag（构建 + Pre-Release）
release/v{主}.{次}.{修订}-preview
```

示例：
- `build/v0.2.0-alpha-eef7afc` - v0.2.0 开发构建（commit: eef7afc）
- `release/v0.2.0` - v0.2.0 正式发布
- `release/v0.2.0-preview` - v0.2.0 预览发布（GitHub Pre-release）

#### 触发构建

```bash
# 1. 确保代码已提交
git add .
git commit -m "feat: 新功能"
git push origin feature/xxx

# 2. 创建并推送 build tag
git tag build/v0.2.0-alpha-$(git rev-parse --short=7 HEAD)
git push origin build/v0.2.0-alpha-xxxxxxx

# 3. 等待构建完成，下载 Artifacts
# 查看构建状态: https://github.com/exomind-team/exomind/actions

# 4. 如需正式发布，创建 release tag
git tag release/v0.2.0
git push origin release/v0.2.0

# 5. 如需预览发布，创建 preview tag
git tag release/v0.2.0-preview
git push origin release/v0.2.0-preview
```

#### Android 签名 Secrets（GitHub Actions）

在仓库 `Settings -> Secrets and variables -> Actions` 配置以下 secrets。
说明：`build/**` 与 `release/**` 两类 tag 流程都会执行 Android 签名步骤，因此都要求这些 secrets 已配置。

| Secret 名称 | 说明 |
|------------|------|
| `ANDROID_KEYSTORE_BASE64` | JKS 文件完整二进制内容的 Base64（单行文本） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名（alias） |
| `ANDROID_KEY_PASSWORD` | key 密码 |

推荐使用仓库脚本生成并校验（Windows PowerShell）：

```powershell
.\Scripts\dev\android-signing-secrets.ps1 `
  -KeystorePath "D:\sign\exomind-release.jks" `
  -StorePassword "your-store-password" `
  -KeyAlias "your-alias" `
  -KeyPassword "your-key-password"
```

如需脚本直接写入 GitHub Secrets（需已登录 `gh auth login`）：

```powershell
.\Scripts\dev\android-signing-secrets.ps1 `
  -KeystorePath "D:\sign\exomind-release.jks" `
  -StorePassword "your-store-password" `
  -KeyAlias "your-alias" `
  -KeyPassword "your-key-password" `
  -SetGhSecrets `
  -Repo "exomind-team/exomind"
```

> 注意：workflow 已在 Android 构建早期增加签名 secrets 预检，缺任何一个都会立即失败并提示具体 secret 名称。

#### 构建产物

| 平台 | Job | 产物 | Artifact 名称 |
|------|-----|------|---------------|
| Windows | build-windows | MSI 安装包 | `windows-msi-<hash>` |
| Windows | build-windows | EXE 安装包（NSIS） | `windows-exe-<hash>` |
| Android | build-android | 已签名 APK（build/release, split ABI） | `android-apk-signed-<hash>` |

> Android APK 默认输出 `aarch64 (arm64-v8a)` 与 `x86 (i686)` 两个 ABI，可直接侧载安装。

#### 下载构建产物

1. 打开 https://github.com/exomind-team/exomind/actions
2. 点击对应的 workflow run
3. 在 "Artifacts" 部分下载产物

### 手动触发构建

也可以通过 GitHub Web 界面手动触发：

1. 进入 Actions 标签
2. 选择 "Build & Release" workflow
3. 点击 "Run workflow"
4. 选择分支并运行

---

## 常见问题

### Windows 构建

#### 问：找不到 Visual Studio

**错误**: `error: unable to find Visual Studio`

**解决**: 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)，选择 "C++ 构建工具" 工作负载。

#### 问：Windows SDK 版本错误

**解决**: 在 Visual Studio Installer 中安装对应版本的 Windows SDK。

### Android 构建

#### 问：找不到 Java

**错误**: `JAVA_HOME is not set`

**解决**:
```bash
# Windows
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.9.9-hotspot"

# Linux/macOS
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

#### 问：Android SDK 初始化失败

**解决**:
```bash
# 重新初始化
bun run tauri android init

# 或者手动安装 SDK 组件
# 打开 Android Studio -> SDK Manager
# 确保安装了:
# - Android SDK Platform 34
# - Android SDK Build-Tools
# - NDK (Side by side)
```

#### 问：构建超时

Android 首次构建可能需要 10+ 分钟。确保：
- 网络稳定（Maven 依赖下载）
- 磁盘空间充足（10GB+）
- 内存充足（8GB+）

### GitHub Actions

#### 问：构建失败如何排查

1. 查看 Actions 日志：
   - 进入 https://github.com/exomind-team/exomind/actions
   - 点击失败的 workflow run
   - 查看具体步骤的日志

2. 常见失败原因：
   - 依赖安装超时（重试）
   - 子模块未初始化（检查 git 配置）
   - 权限不足（检查 secrets 配置）

#### 问：如何删除错误 Tag

```bash
# 删除本地 tag
git tag -d build/v0.1.0-alpha-xxxxxx

# 删除远程 tag
git push origin :refs/tags/build/v0.1.0-alpha-xxxxxx
# 或
git push origin --delete build/v0.1.0-alpha-xxxxxx
```

---

## 快速参考

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun install` | 安装依赖 |
| `bun run tauri dev` | 桌面端开发 |
| `bun run tauri build` | 桌面端发布构建 |
| `bun run tauri android init` | Android 初始化 |
| `bun run tauri android dev` | Android 开发 |
| `bun run tauri android build --debug` | Android Debug 构建 |

### 环境变量

| 变量 | 说明 | Windows 示例 |
|------|------|--------------|
| `ANDROID_HOME` | Android SDK 路径 | `D:\Android\Sdk` |
| `ANDROID_SDK_ROOT` | Android SDK 根路径 | `D:\Android\Sdk` |
| `JAVA_HOME` | JDK 17 路径 | `C:\Program Files\Eclipse Adoptium\jdk-17.0.9.9-hotspot` |
| `RUST_TOOLCHAIN` | Rust 工具链 | `stable` |

---

## 相关链接

- [Tauri 文档](https://tauri.app/v2/)
- [Tauri Android 开发](https://tauri.app/v2/guides/building/android)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Android Studio](https://developer.android.com/studio)
