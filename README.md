# Exomind

> 个人/集体的生命成长助手
> ExoMind - 帮助用户主动地掌控自己的生命过程

## 核心定位

**ExoMind** 是一个**个人/集体的生命成长助手**，基于 Tauri v2 的跨平台桌面/移动应用，使用 React + TypeScript 构建前端，Rust 构建原生后端。

## 核心特性

### 生命系统
| 特性 | 描述 |
|------|------|
| **消息历史** | 本地持久化存储，启动时自动加载 |
| **多端同步** | WebSocket 设备直连，消息实时同步 |
| **本地优先** | 乐观更新，离线可用，网络恢复自动同步 |
| **设备配对** | 6 位数字配对码，安全设备发现 |

### 技术特性
| 特性 | 描述 |
|------|------|
| **跨平台** | Windows / macOS / Linux / Android |
| **本地 IP 获取** | 原生 UDP Socket，排除 VPN 虚拟接口 |
| **随机端口** | 1949-2026 端口段，碰撞检测 |
| **暗色模式** | 完整 UI 暗色主题支持 |

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
bun run tauri dev

# Android 开发（需要 Android Studio + JDK 17）
bun run tauri android dev
```

### GitHub 评论自动化（Bun + TypeScript）

用于新增、追加、覆盖 Issue/PR 评论，避免手工编辑时的转义问题。

```powershell
# 新增评论
npm run gh:comment -- --type issue --number 93 --file docs/report.md

# 追加到指定评论
npm run gh:comment -- --ref "https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944" --file docs/add.md --mode append

# 覆盖指定评论
npm run gh:comment -- --comment "#issuecomment-3883010944" --repo exomind-team/exomind --type issue --number 93 --file docs/final.md --mode replace

# 预览解析结果，不写入
npm run gh:comment -- --ref "https://github.com/exomind-team/exomind/pull/89" --body "preview" --dry-run
```

更多参数和 PowerShell 用法见：`Scripts/README.md`。

### 消息同步使用

1. **桌面端**：启动后在设置页面查看本机 IP 和端口
2. **移动端**：连接同一局域网，输入桌面端 IP 和端口
3. **配对**：使用 6 位数字配对码完成设备认证
4. **同步**：消息自动同步，历史记录本地存储

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
│   ├── main.tsx              # React 入口
│   ├── components/           # React 组件
│   │   ├── Chat/            # 聊天界面
│   │   │   ├── ChatWindow.tsx    # 微信风格对话界面
│   │   │   ├── DevicePanel.tsx   # 设备列表面板
│   │   │   └── MessageList.tsx   # 消息列表组件
│   │   └── Settings/        # 设置页面
│   ├── lib/
│   │   └── stores/          # 状态管理
│   │       └── chat-store.ts     # 聊天状态管理
│   └── components/ui/       # shadcn/ui 基础组件
├── src-tauri/               # Tauri 后端代码
│   ├── src/
│   │   ├── lib.rs          # Rust 核心库
│   │   ├── main.rs         # 程序入口
│   │   └── commands/       # Tauri 命令
│   │       ├── ws_commands.rs     # WebSocket 连接命令
│   │       ├── file_commands.rs   # 文件操作命令
│   │       ├── pairing_commands.rs # 设备配对命令
│   │       └── network_commands.rs # 网络命令
│   ├── capabilities/        # 权限配置
│   ├── gen/android/        # Android 项目
│   ├── Cargo.toml          # Rust 配置
│   └── tauri.conf.json    # Tauri 配置
├── docs/                   # 文档
│   ├── API.md             # API 参考文档
│   ├── commands/          # 命令详细文档
│   ├── specs/             # 模块规格文档
│   └── ARCHITECTURE_7LAYER.md # 7层架构设计
├── tests/                 # 测试文件
│   ├── components/        # 组件测试
│   ├── sync/              # 同步协议测试
│   └── e2e/              # 端到端测试
└── README.md              # 本文件
```

## 前端-后端通信

### 调用 Tauri 命令

**前端调用 Rust：**
```typescript
import { invoke } from "@tauri-apps/api/core";

// WebSocket 连接
const result = await invoke('ws_connect', {
  url: 'ws://192.168.1.100:1949'
});

// 获取本机 IP
const ip = await invoke('get_local_ip_with_current_port', {
  port: 1949
});
```

**Rust 定义命令：**
```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}
```

### API 参考

| 模块 | 命令 | 功能 |
|------|------|------|
| WebSocket | `ws_connect` | 连接 WebSocket 服务器 |
| WebSocket | `ws_disconnect` | 断开连接 |
| WebSocket | `ws_send` | 发送消息 |
| WebSocket | `ws_get_state` | 获取连接状态 |
| 文件 | `append_file` | 追加文件（永覆盖） |
| 文件 | `read_file` | 读取文件 |
| 配对 | `generate_pairing_code` | 生成 6 位配对码 |
| 配对 | `confirm_pairing` | 确认配对 |
| 网络 | `get_local_ip_with_current_port` | 获取本机 IP（指定端口） |
| 网络 | `get_local_ip_with_random_port` | 获取本机 IP（随机端口） |

完整 API 文档: [docs/API.md](docs/API.md)

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
- **可执行文件**: `src-tauri/target/release/exomind.exe`
- **MSI 安装包**: `src-tauri/target/release/bundle/msi/exomind_0.1.0_x64_en-US.msi`
- **NSIS 安装包**: `src-tauri/target/release/bundle/nsis/exomind_0.1.0_x64-setup.exe`

### Android
- **Debug APK**: `src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk`
- **Release APK**: `src-tauri/gen/android/app/build/outputs/apk/release/app-release-unsigned.apk`

## CI/CD 自动化构建

### GitHub Actions

项目使用 GitHub Actions 实现自动化构建和发布。

#### 构建触发方式

| Tag 模式 | 触发条件 | 产出 |
|----------|----------|------|
| `build/v*` | 推送 build tag | 构建产物 (Artifact) |
| `release/v*` | 推送 release tag | 构建产物 + GitHub Release |

#### 使用方法

```bash
# 触发构建（仅构建，不发布）
git tag build/v0.1.0-alpha-abc123
git push origin build/v0.1.0-alpha-abc123

# 触发发布（构建 + GitHub Release）
git tag release/v0.1.0
git push origin release/v0.1.0
```

#### 版本号格式

```
build/v{主}.{次}.{修订}-{commit_hash}
release/v{主}.{次}.{修订}
```

示例：
- `build/v0.1.0-alpha-eef7afc` - v0.1.0 开发构建
- `release/v0.1.0` - v0.1.0 正式发布

#### 构建产物

| 平台 | 产物 | 下载位置 |
|------|------|----------|
| Windows | MSI 安装包 | Actions Artifacts |
| Android | Debug APK | Actions Artifacts |

### 本地构建

```powershell
# 桌面端构建
bun run tauri build --bundles msi

# Android 构建
bun run tauri android init    # 首次需要初始化
bun run tauri android build   # Debug 构建
```

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

| 文档 | 描述 |
|------|------|
| [API.md](docs/API.md) | Tauri 命令 API 参考 |
| [ARCHITECTURE_7LAYER.md](docs/ARCHITECTURE_7LAYER.md) | 7层架构详解 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 完整架构设计 |
| [CLAUDE.md](CLAUDE.md) | 项目开发规范 |

### 模块

| 模块 | 说明 |
|------|------|
| [modules/ExoMind-NLS-Guardian/](modules/ExoMind-NLS-Guardian/) | Android 通知权限守护模块 |

## License

MIT
