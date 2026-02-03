# Exomind

基于 Tauri v2 的跨平台桌面应用，使用 React + TypeScript 构建前端，Rust 构建原生后端。

## 项目标识

| 属性 | 值 |
|------|-----|
| **应用名称** | Exomind |
| **包名** | `com.exomind.app` |
| **Rust Crate** | `exomind` |
| **版本** | 0.1.0 |

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 18.3.1 |
| 前端语言 | TypeScript | 5.6.2 |
| 构建工具 | Vite | 6.0.3 |
| 桌面框架 | Tauri | v2 |
| 后端语言 | Rust | Edition 2021 |
| 包管理器 | Bun | - |

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) - JavaScript 包管理器
- [Rust](https://www.rust-lang.org/tools/install) - 后端编译
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) - Windows 编译依赖

### 安装依赖

```bash
bun install
```

### 开发模式

```powershell
# 桌面端开发
.\dev.ps1 desktop

# 或 Android 开发（需要 Android Studio）
.\dev.ps1 android
```

## 自动化构建脚本

项目包含完整的自动化构建脚本：

| 脚本 | 功能 |
|------|------|
| `build-android-auto.ps1` | ⭐ Android 全自动构建+安装 |
| `build-desktop-v2.ps1` | 桌面端构建 + 计时统计 |
| `build-all-v2.ps1` | 一键构建所有平台 |
| `dev.ps1` | 启动开发服务器 |

### 快速构建

```powershell
# 构建桌面端并生成安装包
.\build-desktop-v2.ps1

# 构建 Android 并自动安装到设备
.\build-android-auto.ps1

# 一键构建所有平台
.\build-all-v2.ps1
```

## 项目结构

```
exomind/
├── src/                      # 前端源代码
│   ├── App.tsx              # 主应用组件
│   ├── main.tsx             # React 入口
│   ├── App.css              # 样式文件
│   └── assets/              # 静态资源
├── src-tauri/               # Tauri 后端代码
│   ├── src/
│   │   ├── lib.rs          # Rust 核心代码（包名：exomind_lib）
│   │   └── main.rs         # 程序入口
│   ├── capabilities/       # 权限配置
│   ├── gen/android/       # Android 项目（包名：com.exomind.app）
│   ├── Cargo.toml         # Rust 配置（crate：exomind）
│   └── tauri.conf.json    # Tauri 配置（productName：exomind）
├── build-*.ps1            # 自动化构建脚本
├── dev.ps1               # 开发启动脚本
└── README.md             # 本文件
```

## 前端-后端通信

**前端调用 Rust：**
```typescript
import { invoke } from "@tauri-apps/api/core";

const response = await invoke("greet", { name: "World" });
console.log(response); // "Hello, World! You've been greeted from Rust!"
```

**Rust 定义命令：**
```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
```

## 配置详情

### package.json
```json
{
  "name": "exomind"
}
```

### src-tauri/tauri.conf.json
```json
{
  "productName": "exomind",
  "identifier": "com.exomind.app",
  "app": {
    "windows": [{ "title": "exomind" }]
  }
}
```

### src-tauri/Cargo.toml
```toml
[package]
name = "exomind"

[lib]
name = "exomind_lib"
```

### Android 配置
- **Namespace**: `com.exomind.app`
- **ApplicationId**: `com.exomind.app`

## 构建输出

### 桌面端
- **可执行文件**: `src-tauri\target\release\exomind.exe`
- **MSI 安装包**: `src-tauri\target\release\bundle\msi\exomind_0.1.0_x64_en-US.msi`
- **NSIS 安装包**: `src-tauri\target\release\bundle\nsis\exomind_0.1.0_x64-setup.exe`

### Android
- **Debug APK**: `src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk`
- **Release APK**: `src-tauri\gen\android\app\build\outputs\apk\release\app-release-unsigned.apk`

## 脚本配置

如需修改 Java/Android SDK 路径，编辑 `build-android-auto.ps1`：

```powershell
$Config = @{
    Java17 = "D:\data\AndroidStudioSDK\java17"
    AndroidSdk = "D:\data\AndroidStudioSDK"
}
```

## 重命名检查清单

本项目已从 `tauri-app` 重命名为 `exomind`：

- [x] `package.json` - name: "exomind"
- [x] `src-tauri/tauri.conf.json` - productName: "exomind"
- [x] `src-tauri/tauri.conf.json` - identifier: "com.exomind.app"
- [x] `src-tauri/tauri.conf.json` - windows.title: "exomind"
- [x] `src-tauri/Cargo.toml` - name: "exomind"
- [x] `src-tauri/Cargo.toml` - lib.name: "exomind_lib"
- [x] `src-tauri/src/main.rs` - 引用 exomind_lib
- [x] `index.html` - title: "Exomind"
- [x] `src/App.tsx` - 标题: "Welcome to Exomind"
- [x] Android build.gradle.kts - namespace: "com.exomind.app"
- [x] Android build.gradle.kts - applicationId: "com.exomind.app"
- [x] Android MainActivity.kt - package com.exomind.app
- [x] Android 目录结构 - com/tauri_app/app → com/exomind/app
- [x] 桌面端构建测试通过

## 常见问题

### 1. 找不到 Java
编辑 `build-android-auto.ps1`，修改 `Java17` 路径为你的 Java 17 安装路径。

### 2. 找不到 ADB
编辑 `build-android-auto.ps1`，修改 `AndroidSdk` 路径为你的 Android SDK 路径。

### 3. Android 构建失败
- 确保 Android Studio 已安装
- 确保 NDK 已通过 SDK Manager 安装
- 运行 `bun run tauri android init` 初始化

### 4. 多设备安装失败
```powershell
# 指定设备
.\build-android-auto.ps1 -Device emulator-5554
```

## 参考文档

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - 完整架构设计文档
- [ARCHITECTURE_7LAYER.md](docs/ARCHITECTURE_7LAYER.md) - 7层架构详解
- [Tauri 官方文档](https://tauri.app/)
- [README-Scripts.md](README-Scripts.md) - 脚本详细文档
- [React 文档](https://react.dev/)
- [Vite 文档](https://vitejs.dev/)

## License

MIT
