# Tauri 构建脚本使用指南

本项目提供了一套完整的 PowerShell 自动化构建脚本，支持桌面端和 Android 端的一键构建。

## 快速选择

| 需求 | 推荐脚本 | 说明 |
|------|---------|------|
| 只想构建 Android 并自动安装 | `build-android-auto.ps1` | ⭐ 最常用，全自动 |
| 桌面端快速构建 | `build-desktop-v2.ps1` | 带时间统计 |
| 一键构建所有平台 | `build-all-v2.ps1` | 桌面 + Android |
| 详细查看构建时间 | `build-android-v2.ps1` | 分阶段计时 |

---

## 环境要求

- **Windows** + PowerShell 5.1+
- **Bun** 包管理器
- **Rust** 工具链
- **Java 17**（自动设置，无需配置环境变量）
- **Android SDK** + **NDK**（Android 构建需要）

### 项目路径配置

脚本已预配置以下路径：
```powershell
Java 17:    D:\data\AndroidStudioSDK\java17
Android SDK: D:\data\AndroidStudioSDK
```

如路径不同，请修改脚本中的 `$Config.Java17` 和 `$Config.AndroidSdk`。

---

## 脚本详解

### 1. build-android-auto.ps1 ⭐ 推荐

**功能**: 全自动 Android 构建 + 安装

**特点**:
- 自动检测并设置 Java 17
- 自动检测设备（支持多设备时指定）
- 自动构建 Debug 版并安装
- 显示分阶段耗时统计
- 构建完成播放提示音

**用法**:
```powershell
# 标准用法 - 构建并安装
.\build-android-auto.ps1

# 构建发布版（自动签名）
.\build-android-auto.ps1 -Release

# 构建但不安装
.\build-android-auto.ps1 -NoInstall

# 指定设备安装
.\build-android-auto.ps1 -Device emulator-5554
```

**输出示例**:
```
========================================
  Build Summary
========================================

Stage Timings:
----------------------------------------
  Environment     █ 1.2s
  Check           █ 0.5s
  Clean           ██ 2.1s
  Dependencies    █ 0.1s
  Frontend        ███ 3.8s
  Android         ████████████████████ 285.4s
----------------------------------------
  TOTAL           ██████████████████████ 293.1s

Output:
  File: src-tauri\gen\android\...\app-universal-debug.apk
  Size: 376 MB
  Type: Debug

Installation:
  Device: emulator-5554
  Status: Success
```

---

### 2. build-desktop-v2.ps1

**功能**: Windows 桌面端构建

**特点**:
- 构建 MSI 安装包
- 构建 NSIS 安装程序
- 分阶段耗时统计
- 自动保存构建日志

**用法**:
```powershell
# 标准构建
.\build-desktop-v2.ps1

# 深度清理后构建
.\build-desktop-v2.ps1 -Clean
```

**输出文件**:
- `src-tauri\target\release\bundle\msi\tauri-app_0.1.0_x64_en-US.msi`
- `src-tauri\target\release\bundle\nsis\tauri-app_0.1.0_x64-setup.exe`

---

### 3. build-all-v2.ps1

**功能**: 一键构建桌面端 + Android

**特点**:
- 顺序构建两个平台
- 对比显示各平台耗时
n- 支持跳过某一平台
- 可自动安装 Android

**用法**:
```powershell
# 构建全部
.\build-all-v2.ps1

# 只构建 Android（跳过桌面端）
.\build-all-v2.ps1 -SkipDesktop

# 只构建桌面端（跳过 Android）
.\build-all-v2.ps1 -SkipAndroid

# 构建 Android 并自动安装
.\build-all-v2.ps1 -SkipDesktop -InstallAndroid
```

---

### 4. build-android-v2.ps1

**功能**: Android 详细构建（适合调试）

**特点**:
- 最详细的阶段计时
- 可视化耗时条形图
- 支持 Verbose 详细输出
- 可自动安装

**用法**:
```powershell
# 标准构建
.\build-android-v2.ps1

# 构建并安装
.\build-android-v2.ps1 -Install

# 详细输出（显示完整编译日志）
.\build-android-v2.ps1 -Verbose

# 深度清理（包括 Gradle 缓存）
.\build-android-v2.ps1 -Clean
```

---

## 执行策略设置

首次运行 PowerShell 脚本可能需要设置执行策略：

```powershell
# 以管理员身份运行 PowerShell，执行：
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 或在每次运行时临时绕过：
powershell -ExecutionPolicy Bypass -File build-android-auto.ps1
```

---

## 设备连接

### 检查设备
```powershell
# 查看连接的设备
adb devices

# 输出示例：
# List of devices attached
# emulator-5554    device
# 8GH0220820003069 device
```

### 多设备处理
当连接多个设备时，`build-android-auto.ps1` 会：
1. 默认选择第一个设备
2. 或通过 `-Device` 参数指定

```powershell
# 指定特定设备
.\build-android-auto.ps1 -Device emulator-5554
```

---

## 构建日志

所有脚本自动保存构建日志到 `build-logs/` 目录：

```
build-logs/
├── android-build-20250203-101532.log
├── desktop-build-20250203-102145.log
├── all-build-20250203-103000.log
└── auto-build-20250203-112206.log
```

日志内容包括：
- 构建日期时间
- 各阶段耗时
- 输出文件路径和大小
- 设备信息

---

## 文件说明

| 文件 | 说明 | 推荐度 |
|------|------|--------|
| `build-android-auto.ps1` | 全自动 Android 构建+安装 | ⭐⭐⭐ |
| `build-desktop-v2.ps1` | 桌面端计时版 | ⭐⭐⭐ |
| `build-all-v2.ps1` | 一键全平台 | ⭐⭐ |
| `build-android-v2.ps1` | Android 详细计时版 | ⭐⭐ |
| `build-android-simple.ps1` | Android 简化版 | ⭐ |
| `build-desktop.ps1` | 桌面端旧版 | ⭐ |
| `build-android.ps1` | Android 旧版 | ⭐ |
| `build-all.ps1` | 全平台旧版 | ⭐ |

---

## 常见问题

### Q: 找不到 Java 17
**A**: 修改脚本中的路径：
```powershell
$Config.Java17 = "你的Java17路径"
```

### Q: 找不到 ADB
**A**: 修改脚本中的路径：
```powershell
$Config.AndroidSdk = "你的Android SDK路径"
```

### Q: Android 构建失败
**A**: 检查以下几点：
1. `src-tauri/gen/android` 是否存在（未初始化则运行 `bun run tauri android init`）
2. `ANDROID_HOME` 环境变量是否设置
3. NDK 是否正确安装

### Q: 安装失败（证书错误）
**A**: 发布版 APK 需要签名，使用 Debug 版或添加签名步骤：
```powershell
# 使用 Debug 版（自动签名）
.\build-android-auto.ps1

# 或发布版（自动创建密钥签名）
.\build-android-auto.ps1 -Release
```

### Q: 多设备时安装到错误的设备
**A**: 使用 `-Device` 参数指定：
```powershell
.\build-android-auto.ps1 -Device emulator-5554
```

---

## 完整工作流示例

```powershell
# 1. 开发阶段 - 启动开发服务器
.\dev.ps1 android

# 2. 测试阶段 - 构建并安装
.\build-android-auto.ps1

# 3. 发布阶段 - 构建所有平台
.\build-all-v2.ps1

# 4. 查看构建日志
cat build-logs\*.log
```

---

## 脚本更新日志

### v2.1 (build-android-auto.ps1)
- 新增全自动检测和安装
- 支持自动签名
- 优化多设备处理

### v2.0
- 新增分阶段计时统计
- 新增可视化条形图
- 新增自动日志保存
- 新增完成提示音
- 统一代码风格

---

## 技术支持

- [Tauri 官方文档](https://tauri.app/)
- [Tauri Android 指南](https://tauri.app/v2/guides/mobile/android/)
- [Android Studio 下载](https://developer.android.com/studio)
