# Tauri 构建脚本使用指南

本项目提供了一套 PowerShell 自动化构建脚本，简化桌面端和 Android 的构建流程。

## 环境要求

- **Bun**: 包管理器
- **Rust**: Tauri 后端编译
- **Java 17**: 位于 `D:\data\AndroidStudioSDK\java17`（Android 构建必需）
- **Android SDK**: 已配置 `ANDROID_HOME` 环境变量

## 脚本说明

### 1. dev.ps1 - 开发模式

启动开发服务器，支持热重载。

```powershell
# 桌面端开发（默认）
.\dev.ps1
.\dev.ps1 desktop

# Android 开发
.\dev.ps1 android
```

### 2. build-desktop.ps1 - 构建桌面端

构建 Windows 桌面应用，生成 MSI 和 EXE 安装包。

```powershell
.\build-desktop.ps1
```

**输出文件:**
- `src-tauri\target\release\bundle\msi\tauri-app_0.1.0_x64_en-US.msi`
- `src-tauri\target\release\bundle\nsis\tauri-app_0.1.0_x64-setup.exe`

### 3. build-android.ps1 - 构建 Android

自动设置 Java 17 环境变量，构建 Android APK。

```powershell
.\build-android.ps1
```

**功能特点:**
- 自动检测并使用 `D:\data\AndroidStudioSDK\java17`
- 自动清理旧的 Android 构建产物
- 构建完成后可选择安装到设备

**输出文件:**
- `src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk`

### 4. build-all.ps1 - 一键构建全部

依次构建桌面端和 Android。

```powershell
.\build-all.ps1
```

## 快速开始

### 首次构建

```powershell
# 1. 确保在项目根目录
cd D:\project\tauri-app

# 2. 构建桌面端
.\build-desktop.ps1

# 3. 构建 Android
.\build-android.ps1
```

### 日常开发

```powershell
# 启动开发服务器
.\dev.ps1

# 代码修改后，构建发布版本
.\build-all.ps1
```

## 故障排除

### Android 构建失败

1. **Java 版本错误**: 脚本会自动使用 `D:\data\AndroidStudioSDK\java17`，如果路径不同请修改脚本中的 `$JAVA_17_PATH`

2. **Android 项目未初始化**:
   ```powershell
   bun run tauri android init
   ```

3. **SDK/NDK 问题**: 确保环境变量已设置
   ```powershell
   $env:ANDROID_HOME
   $env:NDK_HOME
   ```

### 清理构建缓存

如果遇到奇怪的错误，尝试清理:

```powershell
# 清理 Rust 构建
Remove-Item -Recurse -Force src-tauri/target

# 清理前端构建
Remove-Item -Recurse -Force dist
Remove-Item -Recurse -Force node_modules

# 重新安装依赖
bun install
```

## 自定义配置

### 修改 Java 路径

编辑 `build-android.ps1`，修改第一行:

```powershell
$JAVA_17_PATH = "你的Java17路径"
```

### 添加其他构建目标

在 `build-desktop.ps1` 中可以添加其他 bundle 格式:

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "targets": ["msi", "nsis", "appimage", "dmg"]
  }
}
```

## 脚本权限

如果无法运行脚本，可能需要设置执行策略:

```powershell
# 以管理员身份运行 PowerShell，然后执行
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 参考资料

- [Tauri 构建文档](https://tauri.app/v1/guides/building/)
- [Tauri Android 文档](https://tauri.app/v2/guides/mobile/android/)
