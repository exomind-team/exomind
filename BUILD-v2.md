# Tauri 构建脚本 v2 - 使用指南

增强版构建脚本，带有详细的时间统计和构建日志功能。

## 新功能特性

- ⏱️ **精确计时**: 每个构建阶段单独计时
- 📊 **可视化统计**: 阶段耗时条形图
- 📝 **自动日志**: 保存每次构建的详细日志到 `build-logs/` 目录
- 🔔 **完成提示音**: 构建完成播放提示音
- 🎨 **彩色输出**: 清晰的彩色状态输出
- 🧹 **智能清理**: 自动清理旧构建产物

## 脚本清单

| 脚本 | 功能 | 参数 |
|------|------|------|
| `build-desktop-v2.ps1` | 桌面端构建 | `[-Clean]` |
| `build-android-v2.ps1` | Android 构建 | `[-Install] [-Clean] [-Verbose]` |
| `build-all-v2.ps1` | 一键构建所有 | `[-SkipDesktop] [-SkipAndroid] [-InstallAndroid]` |

## 使用方法

### 桌面端构建

```powershell
# 标准构建
.\build-desktop-v2.ps1

# 深度清理后构建
.\build-desktop-v2.ps1 -Clean
```

### Android 构建

```powershell
# 标准构建
.\build-android-v2.ps1

# 构建并安装到设备
.\build-android-v2.ps1 -Install

# 详细输出（显示完整日志）
.\build-android-v2.ps1 -Verbose

# 深度清理后构建
.\build-android-v2.ps1 -Clean
```

### 一键构建全部

```powershell
# 构建桌面端 + Android
.\build-all-v2.ps1

# 只构建 Android
.\build-all-v2.ps1 -SkipDesktop

# 构建 Android 并安装
.\build-all-v2.ps1 -InstallAndroid

# 只构建桌面端
.\build-all-v2.ps1 -SkipAndroid
```

## 输出示例

```
========================================
  Build Statistics
========================================

Stage Timings:
----------------------------------------
  Environment Check    █ 1.2s
  Cleanup              ██ 2.5s
  Dependencies         █ 1.8s
  Frontend Build       ████ 4.3s
  Android Build        ████████████████████████████ 32.8s
----------------------------------------
  TOTAL                ████████████████████████████████ 42.6s

Time Info:
  Started:  10:15:32
  Finished: 10:16:15
  Date:     2025-02-03

Output Files:
  [APK] app-universal-release-unsigned.apk
        Size: 28.3 MB
        Path: src-tauri\gen\android\app\build\outputs\apk\...

[INFO] Build log saved: build-logs/android-build-20250203-101532.log
```

## 构建日志

每次构建会自动生成日志文件：

```
build-logs/
├── android-build-20250203-101532.log
├── desktop-build-20250203-102145.log
└── all-build-20250203-103000.log
```

日志内容包含：
- 构建日期时间
- 各阶段耗时
- 环境版本信息
- 输出文件列表
- 文件大小

## 参数说明

### build-android-v2.ps1

| 参数 | 说明 |
|------|------|
| `-Install` | 构建成功后自动安装到连接的 Android 设备 |
| `-Clean` | 深度清理，包括 Gradle 缓存 |
| `-Verbose` | 显示完整构建输出（默认只显示关键信息） |

### build-desktop-v2.ps1

| 参数 | 说明 |
|------|------|
| `-Clean` | 清理 dist 和 target 目录 |
| `-Target` | 构建目标：`msi`, `nsis`, 或 `all` |

### build-all-v2.ps1

| 参数 | 说明 |
|------|------|
| `-SkipDesktop` | 跳过桌面端构建 |
| `-SkipAndroid` | 跳过 Android 构建 |
| `-InstallAndroid` | 构建后自动安装 Android APK |

## 执行策略设置

如果无法运行脚本，以管理员身份运行 PowerShell：

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

或者临时绕过：

```powershell
powershell -ExecutionPolicy Bypass -File build-android-v2.ps1
```

## 环境要求

- PowerShell 5.1 或更高版本
- Windows Terminal（推荐，支持更好的颜色显示）
- Bun 包管理器
- Rust 工具链
- Android SDK + NDK（Android 构建）
- Java 17（位于 `D:\data\AndroidStudioSDK\java17`）

## 旧脚本兼容性

v1 脚本仍然可用：
- `build-desktop.ps1`
- `build-android.ps1`
- `build-all.ps1`

推荐使用 v2 版本以获得更好的体验。
